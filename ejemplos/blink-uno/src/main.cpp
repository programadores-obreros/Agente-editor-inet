#include <Arduino.h>

// Ejemplo: parpadear el LED integrado del Arduino UNO (pin 13).
// Probado y compilado con PlatformIO.

void setup() {
  pinMode(13, OUTPUT);      // Configuramos el pin 13 como salida
}

void loop() {
  digitalWrite(13, HIGH);   // Encendemos el LED (5V)
  delay(1000);              // Esperamos 1 segundo
  digitalWrite(13, LOW);    // Apagamos el LED (0V)
  delay(1000);              // Esperamos 1 segundo
}
