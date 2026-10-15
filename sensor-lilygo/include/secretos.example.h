// Copiar este archivo como include/secretos.h y llenar los valores.
// secretos.h no se sube al repo (esta en .gitignore).
#pragma once

// Red WiFi a la que se conecta el nodo (solo 2.4 GHz: el ESP32 no ve redes de 5 GHz)
#define WIFI_SSID       "mi-red"
#define WIFI_PASSWORD   "mi-clave"   // red abierta (sin clave): dejar ""

// Gestor en la EC2 (recibe las lecturas y las guarda en Orion). Solo el host, sin http://
#define GESTOR_HOST        "ec2-3-234-196-13.compute-1.amazonaws.com"
#define GESTOR_PUERTO      80

// Clave de este dispositivo: la misma que tiene sensor01 en DISPOSITIVOS de gestor/.env
#define DISPOSITIVO_CLAVE  "cambia-esta-clave"
