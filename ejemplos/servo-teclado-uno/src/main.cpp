#include <Arduino.h>
#include <Servo.h>

// Ejemplo: mover un servo SG90 con el teclado (Arduino UNO).
// Usa la libreria Servo, declarada en lib_deps del platformio.ini
// (PlatformIO no la incluye sola, hay que pedirla).

Servo servo;             // objeto que controla el servo
int angulo = 90;         // posicion inicial (centro, entre 0 y 180)

void setup() {
  Serial.begin(9600);    // debe coincidir con monitor_speed del platformio.ini
  servo.attach(9);       // servo en el pin 9 (naranja=senal, rojo=5V, marron=GND)
  servo.write(angulo);   // llevamos el servo a la posicion inicial (centro)
  Serial.println("Listo. Apreta 'a' (izquierda) o 'd' (derecha).");
}

void loop() {
  if (Serial.available() > 0) {                     // llego una tecla?
    char tecla = Serial.read();                     // la leemos
    if (tecla == 'a' && angulo > 0)   angulo -= 10; // izquierda, sin pasar de 0
    if (tecla == 'd' && angulo < 180) angulo += 10; // derecha, sin pasar de 180
    servo.write(angulo);                            // movemos el servo
    Serial.print("Angulo: ");
    Serial.println(angulo);                         // mostramos el angulo actual
  }
}
