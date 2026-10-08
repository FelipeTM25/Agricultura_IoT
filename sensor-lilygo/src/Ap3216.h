// Driver minimo del AP3216C (modulo CJMCU-3216): luz ambiente e infrarrojo por I2C.
//
// El chip tiene tres medidas:
//   - ALS: luz ambiente, se convierte a lux con la resolucion del rango elegido.
//   - IR : infrarrojo, cuenta cruda de 10 bits (0..1023). No es irradiancia en
//          W/m2: sirve como indicador relativo de radiacion.
//   - PS : proximidad (no se usa aqui).
//
// Rango del ALS: con el rango por defecto mide hasta 20661 lux. Bajo sol directo
// (~100000 lux) se satura, asi que una lectura de ~20661 significa "al menos eso".
#pragma once

#include <Wire.h>

class Ap3216 {
 public:
  static const uint8_t DIRECCION = 0x1E;

  // Reinicia el chip y activa ALS + PS/IR. Devuelve false si no contesta en el bus.
  bool begin(TwoWire &bus = Wire) {
    _bus = &bus;
    if (!escribir(REG_SISTEMA, MODO_RESET)) {
      return false;
    }
    delay(15);
    return escribir(REG_RANGO_ALS, RANGO_20661_LUX) && escribir(REG_SISTEMA, MODO_ALS_PS_IR);
  }

  // Lee luz (lux) e infrarrojo (cuentas). Devuelve false si fallo el I2C o si el
  // IR quedo invalido por exceso de luz (bit de overflow).
  bool leer(float &lux, uint16_t &ir) {
    uint8_t irBajo, irAlto, alsBajo, alsAlto;
    if (!leerRegistro(REG_IR_BAJO, irBajo) || !leerRegistro(REG_IR_ALTO, irAlto) ||
        !leerRegistro(REG_ALS_BAJO, alsBajo) || !leerRegistro(REG_ALS_ALTO, alsAlto)) {
      return false;
    }
    lux = ((uint16_t)alsAlto << 8 | alsBajo) * LUX_POR_CUENTA;
    ir = (uint16_t)irAlto << 2 | (irBajo & 0x03);
    return (irBajo & BIT_IR_OVERFLOW) == 0;
  }

 private:
  static const uint8_t REG_SISTEMA = 0x00;
  static const uint8_t REG_IR_BAJO = 0x0A;
  static const uint8_t REG_IR_ALTO = 0x0B;
  static const uint8_t REG_ALS_BAJO = 0x0C;
  static const uint8_t REG_ALS_ALTO = 0x0D;
  static const uint8_t REG_RANGO_ALS = 0x10;

  static const uint8_t MODO_ALS_PS_IR = 0x03;
  static const uint8_t MODO_RESET = 0x04;
  static const uint8_t RANGO_20661_LUX = 0x00;
  static constexpr float LUX_POR_CUENTA = 0.36f;  // resolucion del rango 20661 lux
  static const uint8_t BIT_IR_OVERFLOW = 0x80;

  TwoWire *_bus = &Wire;

  bool escribir(uint8_t registro, uint8_t valor) {
    _bus->beginTransmission(DIRECCION);
    _bus->write(registro);
    _bus->write(valor);
    return _bus->endTransmission() == 0;
  }

  bool leerRegistro(uint8_t registro, uint8_t &valor) {
    _bus->beginTransmission(DIRECCION);
    _bus->write(registro);
    if (_bus->endTransmission(false) != 0) {
      return false;
    }
    if (_bus->requestFrom(DIRECCION, (uint8_t)1) != 1) {
      return false;
    }
    valor = _bus->read();
    return true;
  }
};
