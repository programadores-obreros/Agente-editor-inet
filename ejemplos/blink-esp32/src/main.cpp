#include <Arduino.h>

// Ejemplo para ESP32-DevKitC.
// El monitor serial confirma que el codigo se cargo (tengas LED o no).
// GPIO2 parpadea si tu placa tiene LED integrado (clones DOIT).

const int PIN_LED = 2;     // GPIO2
int contador = 0;          // cuenta los segundos

void setup() {
  Serial.begin(115200);              // Iniciamos el monitor serial a 115200 baudios
  pinMode(PIN_LED, OUTPUT);          // Configuramos GPIO2 como salida
  Serial.println("ESP32 arrancando..."); // Mensaje de arranque
}

void loop() {
  digitalWrite(PIN_LED, HIGH);       // Encendemos GPIO2
  delay(500);
  digitalWrite(PIN_LED, LOW);        // Apagamos GPIO2
  delay(500);

  contador++;                        // Sumamos 1
  Serial.print("Profe Bot funcionando! Segundos: ");
  Serial.println(contador);          // Mostramos el contador en el monitor serial
}
