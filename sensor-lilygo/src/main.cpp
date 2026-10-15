// Nodo sensor de Agricultura IoT: LilyGO T-Beam (ESP32) que mide el cultivo y
// manda las lecturas por WiFi al gestor, que las valida y las guarda en Orion.
//
//   - HDC1080   temperatura y humedad del aire      I2C de la placa (SDA 21 / SCL 22)
//   - CJMCU-3216 (AP3216C) luz (lux) e infrarrojo   I2C de la placa (SDA 21 / SCL 22)
//   - Sensor capacitivo de humedad del suelo        analogico en HUMEDAD_SUELO_PIN
//   - GPS de la placa en SerialGPS (= Serial1, GPIO34 RX / GPIO12 TX)
//   - WiFi -> HTTP POST al gestor con la clave del dispositivo -> Orion
//
// El bus I2C de la placa lo comparten los dos sensores con el PMU AXP192 (0x34)
// y el OLED (0x3C); no hay choque de direcciones (HDC1080 0x40, AP3216 0x1E).
// setupBoards() ya abre ese bus y el UART del GPS, aqui no se vuelven a abrir.

#include <ClosedCube_HDC1080.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>

#include "Ap3216.h"
#include "LoRaBoards.h"

#if __has_include("secretos.h")
#include "secretos.h"
#else
#error "Falta include/secretos.h: copia include/secretos.example.h y pon tu WiFi, el host del gestor y la clave del dispositivo"
#endif

// Pon TRAZA_ESTADOS en 1 para ver cada transicion de la maquina de estados.
// Es ruidoso (la fase de muestreo repite 3 estados 20 veces), pero sirve para
// mostrar que la maquina esta recorriendo los estados en orden.
#define TRAZA_ESTADOS               0

// ---------------------------------------------------------------------------
// Envio al gestor
// ---------------------------------------------------------------------------
// Orion no se publica a internet (no tiene autenticacion). Cada ciclo el nodo
// manda sus lecturas al gestor con su clave (cabecera X-Api-Key):
//
//   POST http://GESTOR_HOST/api/dispositivos/sensor01/lecturas
//   {"temperatura":23.40,"humedad":61.20,...,"ubicacion":{"lat":6.242500,"lon":-75.589500}}
//
// El gestor comprueba la clave, valida los valores y hace el "append" en Orion
// (crea la entidad sensor01 de tipo SensorAgricola si no existe). Las variables
// sin lectura valida en el ciclo no se mandan, para no pisar el ultimo valor
// bueno con basura.
//
//   temperatura   °C              (HDC1080)
//   humedad       % aire          (HDC1080)
//   humedadSuelo  % suelo         (sensor capacitivo, calibrado abajo)
//   luz           lux             (AP3216)
//   radiacion     cuentas IR 0..1023, indicador relativo (AP3216)
//   ubicacion     lat / lon       (GPS, solo si hay fix)
#define ENTIDAD_ID                  "sensor01"

// Periodo entre envios, contado desde el inicio de cada ciclo. El muestreo y el
// envio caben dentro de esta ventana; DORMIR absorbe el resto para que el
// intervalo sea estable.
#define PERIODO_TX_MS               30000

#define HTTP_TIMEOUT_MS             5000
#define WIFI_ESPERA_INICIAL_MS      15000

// ---------------------------------------------------------------------------
// Sensores
// ---------------------------------------------------------------------------
#define HDC1080_ADDR                0x40
#define HDC1080_ID_FABRICANTE       0x5449  // Texas Instruments

// La libreria del HDC1080 no reporta errores: si el sensor no contesta, el valor
// crudo queda en 0xFFFF y readTemperature() entrega ~124.99 °C (y la humedad
// ~100 %). Con esto se detecta esa lectura fantasma.
#define TEMP_MIN_VALIDA             -40.0f
#define TEMP_MAX_VALIDA             124.0f

// Humedad del suelo: tiene que ir en un pin del ADC1 (GPIO32..39), porque el
// ADC2 no funciona mientras el WiFi esta encendido. En la T-Beam el 32 y 33 son
// del radio, el 34 del GPS y el 35 de la interrupcion del PMU: queda libre el
// 36 (marcado VP en la placa).
#define HUMEDAD_SUELO_PIN           36

// Calibracion del sensor capacitivo (lectura cruda del ADC, 0..4095). Medirla
// con el monitor serie: SUELO_SECO_RAW con el sensor al aire y SUELO_MOJADO_RAW
// con el sensor metido en un vaso de agua. Mas humedad = menor lectura.
#define SUELO_SECO_RAW              3000
#define SUELO_MOJADO_RAW            1300

// Un sensor capacitivo conectado nunca baja de ~1000 (ni metido en agua). Una lectura
// por debajo de esto es que al pin no le llega senal (cable, 3V3/GND o pin equivocado):
// esa muestra se descarta en vez de mandarse como "100 % de humedad".
#define SUELO_CRUDO_MINIMO          200

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------
#define TAM_ARREGLO 20

// Espera entre muestras. El AP3216 entrega un dato nuevo cada ~110 ms en modo
// ALS + PS/IR, asi que tomar muestras mas rapido solo repetiria el mismo valor.
#define ESPERA_MUESTRA_MS           110

// Tras esta cantidad de lecturas fallidas seguidas de un sensor I2C, se reinicia
#define FALLOS_ANTES_DE_REINICIAR   8

enum Estado {
  SALUDO = 1,
  INICIAR_LECTURA,
  ESPERAR_LECTURA,
  CHIRP,
  PRUNING,
  BUNDLING,
  TRANSMITIR,
  DORMIR
};

// Muestras validas de una variable durante un ciclo. Pruning las reduce a
// promedio, minimo y maximo.
struct Serie {
  float v[TAM_ARREGLO];
  uint8_t n;
};

struct Resumen {
  bool valido;
  float promedio;
  float minimo;
  float maximo;
};

enum Variable { TEMPERATURA, HUMEDAD, HUMEDAD_SUELO, LUZ, RADIACION, NUM_VARIABLES };

static const char *const NOMBRE_VARIABLE[NUM_VARIABLES] = {
  "temperatura", "humedad", "humedadSuelo", "luz", "radiacion"
};
static const char *const ETIQUETA_VARIABLE[NUM_VARIABLES] = {
  "Temperatura", "Humedad", "Suelo", "Luz", "Radiacion"
};
static const char *const UNIDAD_VARIABLE[NUM_VARIABLES] = {
  "C", "%", "%", "lux", "IR"
};

struct Bundle {
  Resumen variable[NUM_VARIABLES];
  bool gpsValido;
  double latitud;
  double longitud;
  double altitud;
  uint32_t satelites;
};

uint8_t i;
uint8_t estado;
Serie serie[NUM_VARIABLES];
Bundle bundleActual;
uint32_t contadorEnvios = 0;
uint32_t inicioCiclo = 0;
uint8_t fallosHdc = 0;
uint8_t fallosAp = 0;
uint16_t ultimoCrudoSuelo = 0;

char payload[640];
bool hayDatos = false;
int ultimoCodigoHttp = 0;

ClosedCube_HDC1080 hdc1080;
Ap3216 ap3216;
TinyGPSPlus gps;

// ---------------------------------------------------------------------------
// Impresión
// ---------------------------------------------------------------------------
// Imprime la etiqueta de una fila con ancho fijo, para que todos los valores
// del reporte queden en la misma columna
#define ANCHO_ETIQUETA 11
static void campo(const char *etiqueta) {
  Serial.printf("%-*s : ", ANCHO_ETIQUETA, etiqueta);
}

// Sangria para una linea de continuacion, alineada bajo la columna de valores
static void sangria() {
  Serial.printf("%*s   ", ANCHO_ETIQUETA, "");
}

#define ANCHO_REGLA 62
static void regla(char c, uint8_t n = ANCHO_REGLA) {
  for (uint8_t k = 0; k < n; k++) {
    Serial.print(c);
  }
  Serial.println();
}

#if TRAZA_ESTADOS
static const char *nombreEstado(uint8_t e) {
  switch (e) {
    case SALUDO:          return "SALUDO";
    case INICIAR_LECTURA: return "INICIAR_LECTURA";
    case ESPERAR_LECTURA: return "ESPERAR_LECTURA";
    case CHIRP:           return "CHIRP";
    case PRUNING:         return "PRUNING";
    case BUNDLING:        return "BUNDLING";
    case TRANSMITIR:      return "TRANSMITIR";
    case DORMIR:          return "DORMIR";
    default:              return "?";
  }
}
#endif

// Espera 'ms' milisegundos sin perder datos del GPS: mientras transcurre el
// tiempo va alimentando el parser con lo que llegue por SerialGPS (Serial1).
// El delay(1) cede la CPU al scheduler de FreeRTOS y alimenta el watchdog.
void smartDelay(unsigned long ms) {
  unsigned long inicio = millis();
  do {
    while (SerialGPS.available()) {
      gps.encode(SerialGPS.read());
    }
    delay(1);
  } while (millis() - inicio < ms);
}

// Explica la causa de un "sin fix", pero solo cuando el diagnostico cambia:
// asi no repite la misma pista en cada ciclo.
static void pistaGPS() {
  uint8_t causa;
  if (gps.charsProcessed() < 10) {
    causa = 0;
  }
  else if (gps.passedChecksum() == 0) {
    causa = 1;
  }
  else if (gps.sentencesWithFix() == 0) {
    causa = 2;
  }
  else {
    causa = 3;
  }

  static uint8_t causaAnterior = 255;
  if (causa == causaAnterior) {
    return;
  }
  causaAnterior = causa;

  switch (causa) {
    case 0:
      sangria();
      Serial.println("^ no llega nada por Serial1: alimentacion del modulo (LDO3) o pines 34/12");
      break;
    case 1:
      sangria();
      Serial.println("^ llegan bytes sin sentencia valida: el baudrate no coincide");
      break;
    case 2:
      sangria();
      Serial.println("^ NMEA correcto, solo falta el fix: antena y cielo abierto");
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------
static const char *textoEstadoWifi(wl_status_t s) {
  switch (s) {
    case WL_CONNECTED:      return "conectado";
    case WL_NO_SSID_AVAIL:  return "no se encuentra la red (¿es de 2.4 GHz?)";
    case WL_CONNECT_FAILED: return "fallo la conexion (¿clave correcta?)";
    case WL_CONNECTION_LOST:return "se perdio la conexion";
    case WL_DISCONNECTED:   return "desconectado";
    default:                return "conectando";
  }
}

// Lista las redes que ve la placa y dice si esta la configurada. El ESP32 solo ve redes
// de 2.4 GHz: si la red no aparece aqui, o esta lejos o solo emite en 5 GHz.
#define REDES_A_MOSTRAR 8
static void escanearRedes() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  int n = WiFi.scanNetworks(); // ya vienen ordenadas de mejor a peor senal

  campo("Redes");
  if (n <= 0) {
    Serial.println("no se ve ninguna red de 2.4 GHz");
    return;
  }
  Serial.printf("%d visibles (2.4 GHz)\n", n);

  int encontrada = -1;
  for (int k = 0; k < n; k++) {
    bool esLaNuestra = WiFi.SSID(k) == WIFI_SSID;
    if (esLaNuestra && encontrada < 0) {
      encontrada = k;
    }
    if (k < REDES_A_MOSTRAR || esLaNuestra) {
      sangria();
      Serial.printf("%s %-24s %4d dBm   canal %2d   %s\n",
                    esLaNuestra ? ">" : " ",
                    WiFi.SSID(k).c_str(),
                    WiFi.RSSI(k),
                    WiFi.channel(k),
                    WiFi.encryptionType(k) == WIFI_AUTH_OPEN ? "abierta" : "con clave");
    }
  }

  bool abierta = encontrada >= 0 && WiFi.encryptionType(encontrada) == WIFI_AUTH_OPEN;
  bool sinClave = strlen(WIFI_PASSWORD) == 0;
  sangria();
  if (encontrada < 0) {
    Serial.printf("^ \"%s\" no aparece: solo emite en 5 GHz o esta fuera de alcance\n", WIFI_SSID);
  }
  else if (abierta != sinClave) {
    Serial.printf("^ \"%s\" es %s pero secretos.h tiene %s\n", WIFI_SSID,
                  abierta ? "abierta" : "con clave", sinClave ? "la clave vacia" : "una clave");
  }
  else {
    Serial.printf("^ \"%s\" esta al alcance\n", WIFI_SSID);
  }
  WiFi.scanDelete();
}

// Comprueba que desde esta red se llega al gestor y que acepta la clave del
// dispositivo. Distingue los problemas tipicos: DNS, portal cautivo (la red pide
// login en una pagina), puerto bloqueado y clave incorrecta.
static void probarGestor() {
  campo("Gestor");
  IPAddress ip;
  if (!WiFi.hostByName(GESTOR_HOST, ip)) {
    Serial.printf("no se pudo resolver %s (DNS de la red)\n", GESTOR_HOST);
    return;
  }

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.begin(String("http://") + GESTOR_HOST + ":" + GESTOR_PUERTO + "/api/dispositivos/" ENTIDAD_ID "/ping");
  http.addHeader("X-Api-Key", DISPOSITIVO_CLAVE);
  int codigo = http.GET();
  String cuerpo = codigo > 0 ? http.getString() : "";
  http.end();

  if (codigo == 200 && cuerpo.indexOf("\"orion\":true") >= 0) {
    Serial.printf("OK    %s (%s) acepta la clave y llega a Orion\n", GESTOR_HOST, ip.toString().c_str());
  }
  else if (codigo == 200) {
    Serial.println("acepta la clave, pero el gestor no llega a Orion (revisar el servidor)");
  }
  else if (codigo == 401) {
    Serial.println("clave rechazada: DISPOSITIVO_CLAVE no coincide con DISPOSITIVOS en gestor/.env");
  }
  else if (codigo >= 300 && codigo < 400) {
    Serial.printf("redirige (HTTP %d): la red tiene portal cautivo y pide iniciar sesion\n", codigo);
  }
  else if (codigo > 0) {
    Serial.printf("HTTP %d inesperado: probable portal cautivo de la red\n", codigo);
  }
  else {
    Serial.printf("sin respuesta de %s:%d (%s): la red bloquea el puerto o no hay salida a internet\n",
                  ip.toString().c_str(), GESTOR_PUERTO, http.errorToString(codigo).c_str());
  }
}

// Arranca la conexion y espera un rato a que quede lista. Si no se logra, el
// ESP32 sigue reintentando solo (setAutoReconnect) y TRANSMITIR lo vuelve a
// revisar en cada ciclo.
static void iniciarWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < WIFI_ESPERA_INICIAL_MS) {
    smartDelay(250);
  }
}

// ---------------------------------------------------------------------------
// Sensores
// ---------------------------------------------------------------------------
// Devuelve si el AP3216 contesto (el HDC1080 se verifica aparte con su ID)
static bool iniciarSensores() {
  hdc1080.begin(HDC1080_ADDR);
  bool apOk = ap3216.begin(Wire);

  analogReadResolution(12);
  analogSetPinAttenuation(HUMEDAD_SUELO_PIN, ADC_11db); // rango completo 0..~3.1 V
  return apOk;
}

// Convierte la lectura cruda del sensor capacitivo en porcentaje de humedad
static float porcentajeSuelo(uint16_t crudo) {
  float p = 100.0f * (float)(SUELO_SECO_RAW - (int)crudo) / (float)(SUELO_SECO_RAW - SUELO_MOJADO_RAW);
  return constrain(p, 0.0f, 100.0f);
}

static void agregar(Variable var, float valor) {
  Serie &s = serie[var];
  if (s.n < TAM_ARREGLO) {
    s.v[s.n++] = valor;
  }
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

// Encabezado del ciclo
void saludo() {
  inicioCiclo = millis(); // referencia para que DORMIR cierre el periodo

  for (uint8_t k = 0; k < NUM_VARIABLES; k++) {
    serie[k].n = 0;
  }

  Serial.println();
  // el encabezado completa el mismo ancho que las reglas del banner
  int escrito = Serial.printf("--- ciclo %-3lu ", (unsigned long)(contadorEnvios + 1));
  regla('-', escrito < ANCHO_REGLA ? ANCHO_REGLA - escrito : 0);
  estado = INICIAR_LECTURA;
}

void iniciarLectura() {
  if (i == 0) {
    campo("Muestreo"); // los puntos de cada muestra se van imprimiendo aqui
  }
  estado = ESPERAR_LECTURA;
}

void esperarLectura() {
  smartDelay(ESPERA_MUESTRA_MS);
  estado = CHIRP;
}

// Toma una muestra de cada sensor y guarda las que son validas. Imprime un
// punto si todos los sensores contestaron y una 'x' si alguno fallo, para no
// soltar una linea por cada una de las 20 muestras.
void chirp() {
  bool todoOk = true;

  // HDC1080: temperatura y humedad del aire
  float temperatura = hdc1080.readTemperature();
  float humedad = hdc1080.readHumidity();
  if (temperatura >= TEMP_MIN_VALIDA && temperatura <= TEMP_MAX_VALIDA) {
    agregar(TEMPERATURA, temperatura);
    agregar(HUMEDAD, humedad);
    fallosHdc = 0;
  }
  else {
    todoOk = false;
    if (++fallosHdc >= FALLOS_ANTES_DE_REINICIAR) {
      fallosHdc = 0;
      hdc1080.begin(HDC1080_ADDR);
    }
  }

  // AP3216: luz e infrarrojo
  float lux;
  uint16_t ir;
  if (ap3216.leer(lux, ir)) {
    agregar(LUZ, lux);
    agregar(RADIACION, ir);
    fallosAp = 0;
  }
  else {
    todoOk = false;
    if (++fallosAp >= FALLOS_ANTES_DE_REINICIAR) {
      fallosAp = 0;
      ap3216.begin(Wire);
    }
  }

  // Humedad del suelo (analogico): solo cuenta si al pin le llega senal
  ultimoCrudoSuelo = analogRead(HUMEDAD_SUELO_PIN);
  if (ultimoCrudoSuelo >= SUELO_CRUDO_MINIMO) {
    agregar(HUMEDAD_SUELO, porcentajeSuelo(ultimoCrudoSuelo));
  }

  Serial.print(todoOk ? '.' : 'x');

  i++;
  if (i >= TAM_ARREGLO) {
    i = 0; // Reiniciar el indice para futuras lecturas
    estado = PRUNING;
  }
  else {
    estado = INICIAR_LECTURA;
  }
}

// Reduce el arreglo de muestras de cada variable a un unico valor (promedio), y
// se queda con el minimo y el maximo para ver de un vistazo que son reales
void pruning() {
  Serial.printf(" %u/%u\n", TAM_ARREGLO, TAM_ARREGLO);

  for (uint8_t k = 0; k < NUM_VARIABLES; k++) {
    Serie &s = serie[k];
    Resumen &r = bundleActual.variable[k];
    r.valido = s.n > 0;

    campo(ETIQUETA_VARIABLE[k]);
    if (!r.valido) {
      Serial.println("sin lecturas validas, no se envia");
      if (k == HUMEDAD_SUELO) {
        sangria();
        Serial.printf("^ crudo %u: no llega senal al GPIO%d, revisa el cable de senal y 3V3/GND del sensor\n",
                      ultimoCrudoSuelo, HUMEDAD_SUELO_PIN);
      }
      continue;
    }

    float acumulado = 0.0f;
    r.minimo = s.v[0];
    r.maximo = s.v[0];
    for (uint8_t j = 0; j < s.n; j++) {
      acumulado += s.v[j];
      if (s.v[j] < r.minimo) {
        r.minimo = s.v[j];
      }
      if (s.v[j] > r.maximo) {
        r.maximo = s.v[j];
      }
    }
    r.promedio = acumulado / s.n;

    Serial.printf("%.2f %s   min %.2f   max %.2f", r.promedio, UNIDAD_VARIABLE[k], r.minimo, r.maximo);
    if (s.n < TAM_ARREGLO) {
      Serial.printf("   (%u/%u muestras)", s.n, TAM_ARREGLO);
    }
    if (k == HUMEDAD_SUELO) {
      Serial.printf("   crudo %u", ultimoCrudoSuelo); // para calibrar SUELO_SECO_RAW / SUELO_MOJADO_RAW
    }
    Serial.println();
  }

  estado = BUNDLING;
}

// Construye el JSON de lecturas para el gestor. Devuelve false si no hay nada
// valido que mandar en este ciclo.
static bool construirPayload() {
  size_t n = snprintf(payload, sizeof(payload), "{");
  bool hayDatos = false;

  for (uint8_t k = 0; k < NUM_VARIABLES && n < sizeof(payload); k++) {
    const Resumen &r = bundleActual.variable[k];
    if (r.valido) {
      n += snprintf(payload + n, sizeof(payload) - n, "%s\"%s\":%.2f", hayDatos ? "," : "", NOMBRE_VARIABLE[k], r.promedio);
      hayDatos = true;
    }
  }

  if (bundleActual.gpsValido && n < sizeof(payload)) {
    n += snprintf(payload + n, sizeof(payload) - n, "%s\"ubicacion\":{\"lat\":%.6f,\"lon\":%.6f}",
                  hayDatos ? "," : "", bundleActual.latitud, bundleActual.longitud);
    hayDatos = true;
  }

  if (n < sizeof(payload)) {
    n += snprintf(payload + n, sizeof(payload) - n, "}");
  }

  if (n >= sizeof(payload)) {
    sangria();
    Serial.println("^ ADVERTENCIA: el payload se trunco, hay que agrandar payload[]");
  }
  return hayDatos;
}

// Empaqueta el resultado de pruning + la posicion GPS actual en un bundle
// listo para transmitir
void bundling() {
  bundleActual.gpsValido = gps.location.isValid();
  bundleActual.latitud = bundleActual.gpsValido ? gps.location.lat() : 0.0;
  bundleActual.longitud = bundleActual.gpsValido ? gps.location.lng() : 0.0;
  bundleActual.altitud = gps.altitude.isValid() ? gps.altitude.meters() : 0.0;
  bundleActual.satelites = gps.satellites.isValid() ? gps.satellites.value() : 0;

  campo("GPS");
  if (bundleActual.gpsValido) {
    Serial.printf("fix   %.6f, %.6f   alt %.1f m   sat %lu\n",
                  bundleActual.latitud,
                  bundleActual.longitud,
                  bundleActual.altitud,
                  (unsigned long)bundleActual.satelites);
  }
  else {
    Serial.printf("sin fix   sat %lu   chars %lu   NMEA %lu   err %lu\n",
                  (unsigned long)bundleActual.satelites,
                  (unsigned long)gps.charsProcessed(),
                  (unsigned long)gps.passedChecksum(),
                  (unsigned long)gps.failedChecksum());
    pistaGPS();
  }

  hayDatos = construirPayload();

  estado = TRANSMITIR;
}

// Muestra el ultimo envio en el OLED y atiende el PMU
static void refrescarPlaca() {
  if (u8g2) {
    const Resumen *v = bundleActual.variable;
    char buf[32];
    u8g2->clearBuffer();
    u8g2->setFont(u8g2_font_6x10_tf);

    if (WiFi.status() != WL_CONNECTED) {
      snprintf(buf, sizeof(buf), "WiFi: sin conexion");
    }
    else if (ultimoCodigoHttp == 204) {
      snprintf(buf, sizeof(buf), "Gestor: OK  #%lu", (unsigned long)contadorEnvios);
    }
    else {
      snprintf(buf, sizeof(buf), "Gestor: error %d", ultimoCodigoHttp);
    }
    u8g2->drawStr(0, 10, buf);

    snprintf(buf, sizeof(buf), "T %.1fC  H %.0f%%", v[TEMPERATURA].promedio, v[HUMEDAD].promedio);
    u8g2->drawStr(0, 23, v[TEMPERATURA].valido ? buf : "T/H: sin sensor");

    snprintf(buf, sizeof(buf), "Suelo %.0f%%", v[HUMEDAD_SUELO].promedio);
    u8g2->drawStr(0, 36, v[HUMEDAD_SUELO].valido ? buf : "Suelo: sin senal");

    snprintf(buf, sizeof(buf), "Luz %.0f  IR %.0f", v[LUZ].promedio, v[RADIACION].promedio);
    u8g2->drawStr(0, 49, v[LUZ].valido ? buf : "Luz: sin sensor");

    if (bundleActual.gpsValido) {
      snprintf(buf, sizeof(buf), "%.4f,%.4f", bundleActual.latitud, bundleActual.longitud);
    }
    else {
      snprintf(buf, sizeof(buf), "GPS: sin fix (%lu sat)", (unsigned long)bundleActual.satelites);
    }
    u8g2->drawStr(0, 62, buf);
    u8g2->sendBuffer();
  }

  loopPMU(); // atiende las interrupciones del AXP192 (boton, USB, bateria)
}

// Envia el bundle al gestor por HTTP; el gestor lo valida y lo guarda en Orion
void transmitir() {
  campo("WiFi");
  wl_status_t s = WiFi.status();
  if (s != WL_CONNECTED) {
    Serial.printf("%s, se reintenta en el proximo ciclo\n", textoEstadoWifi(s));
    ultimoCodigoHttp = 0;
  }
  else if (!hayDatos) {
    Serial.println("conectado, pero ningun sensor dio una lectura valida: no se envia nada");
    ultimoCodigoHttp = 0;
  }
  else {
    Serial.printf("%s   %s   %d dBm\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.begin(String("http://") + GESTOR_HOST + ":" + GESTOR_PUERTO + "/api/dispositivos/" ENTIDAD_ID "/lecturas");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Api-Key", DISPOSITIVO_CLAVE);
    ultimoCodigoHttp = http.POST((uint8_t *)payload, strlen(payload));

    campo("Gestor");
    if (ultimoCodigoHttp == 204) {
      Serial.printf("OK   %u B   (guardado en Orion)\n", (unsigned)strlen(payload));
      contadorEnvios++;
    }
    else if (ultimoCodigoHttp == 401) {
      Serial.println("clave rechazada: revisa DISPOSITIVO_CLAVE en secretos.h");
    }
    else if (ultimoCodigoHttp > 0) {
      // El gestor explica el error en el cuerpo: {"detail": "..."}
      Serial.printf("HTTP %d   %s\n", ultimoCodigoHttp, http.getString().c_str());
    }
    else {
      Serial.printf("sin respuesta (%s)\n", http.errorToString(ultimoCodigoHttp).c_str());
    }
    http.end();
  }

  campo("Payload");
  Serial.println(payload);

  refrescarPlaca();

  estado = DORMIR;
}

// Se duerme en tramos cortos en vez de un solo smartDelay largo, para tener
// puntos de control intermedios y no dejar de alimentar el parser del GPS
#define DORMIR_PASO_MS 50

// Absorbe lo que falte para completar PERIODO_TX_MS desde el inicio del ciclo.
// Asi el intervalo entre envios es estable aunque el muestreo o la respuesta
// del gestor varien de un ciclo a otro.
void dormir() {
  uint32_t transcurrido = millis() - inicioCiclo;
  uint32_t restante = (transcurrido < PERIODO_TX_MS) ? (PERIODO_TX_MS - transcurrido) : 0;

  campo("Dormir");
  Serial.printf("%lu ms   (ciclo objetivo %u ms, usados %lu ms)\n",
                (unsigned long)restante,
                (unsigned)PERIODO_TX_MS,
                (unsigned long)transcurrido);

  while (restante > 0) {
    uint32_t paso = (restante > DORMIR_PASO_MS) ? DORMIR_PASO_MS : restante;
    smartDelay(paso);
    restante -= paso;
  }
  estado = SALUDO;
}

void setup() {
  // setupBoards() abre Serial a 115200, levanta Wire en GPIO21/22 (PMU + OLED +
  // sensores), enciende los LDO del AXP192 (GPS) y ya hace
  // SerialGPS.begin(9600, SERIAL_8N1, GPIO34, GPIO12), asi que el GPS no
  // necesita ninguna inicializacion extra aqui.
  setupBoards();

  // When the power is turned on, a delay is required.
  delay(1500);

  delay(20); // el HDC1080 tarda ~15 ms en estar listo
  bool apOk = iniciarSensores();
  uint16_t fabricante = hdc1080.readManufacturerId();

  Serial.println();
  regla('=');
  Serial.println("  Agricultura IoT  |  T-Beam -> WiFi -> Gestor -> Orion");
  regla('=');

  campo("HDC1080");
  if (fabricante == HDC1080_ID_FABRICANTE) {
    Serial.printf("OK    0x%02X en SDA=%d / SCL=%d\n", HDC1080_ADDR, I2C_SDA, I2C_SCL);
  }
  else {
    Serial.printf("NO RESPONDE (ID 0x%04X, se esperaba 0x%04X)\n", fabricante, HDC1080_ID_FABRICANTE);
  }

  campo("AP3216");
  Serial.printf(apOk ? "OK    0x%02X\n" : "NO RESPONDE en 0x%02X\n", Ap3216::DIRECCION);

  campo("Suelo");
  Serial.printf("GPIO%d   crudo %u   (seco %d / mojado %d)\n",
                HUMEDAD_SUELO_PIN, analogRead(HUMEDAD_SUELO_PIN), SUELO_SECO_RAW, SUELO_MOJADO_RAW);

  campo("GPS");
  Serial.printf("Serial1 @ %d baud   RX=%d / TX=%d\n", GPS_BAUD_RATE, GPS_RX_PIN, GPS_TX_PIN);

  campo("OLED");
  Serial.println(u8g2 ? "OK" : "no detectado");

  escanearRedes();

  campo("WiFi");
  Serial.printf("conectando a \"%s\"%s...\n", WIFI_SSID, strlen(WIFI_PASSWORD) == 0 ? " (red abierta)" : "");
  iniciarWifi();
  sangria();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("conectado   IP %s   %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }
  else {
    Serial.printf("%s, se sigue intentando en segundo plano\n", textoEstadoWifi(WiFi.status()));
  }

  campo("Destino");
  Serial.printf("http://%s:%d/api/dispositivos/%s/lecturas\n", GESTOR_HOST, GESTOR_PUERTO, ENTIDAD_ID);
  if (WiFi.status() == WL_CONNECTED) {
    probarGestor();
  }

  estado = SALUDO;
  i = 0;
}

void loop() {
#if TRAZA_ESTADOS
  static uint8_t estadoAnterior = 0;
  if (estado != estadoAnterior) {
    Serial.printf("\n[%s]\n", nombreEstado(estado));
    estadoAnterior = estado;
  }
#endif

  if (estado == SALUDO) {
    saludo();
  }
  else if (estado == INICIAR_LECTURA) {
    iniciarLectura();
  }
  else if (estado == ESPERAR_LECTURA) {
    esperarLectura();
  }
  else if (estado == CHIRP) {
    chirp();
  }
  else if (estado == PRUNING) {
    pruning();
  }
  else if (estado == BUNDLING) {
    bundling();
  }
  else if (estado == TRANSMITIR) {
    transmitir();
  }
  else if (estado == DORMIR) {
    dormir();
  }
}
