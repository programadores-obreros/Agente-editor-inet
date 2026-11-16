// H-02 — `Arduino.h` MINIMO, solo para tests (no es el core de Arduino ni se instala).
//
// Declara exactamente lo que usa el programa que genera `opencode/codegen`, con los tipos del core,
// para que un compilador del host (`g++ -fsyntax-only`) pueda decir si el `main.cpp` generado es
// C++ valido sin tener PlatformIO ni una plataforma instalada. No prueba que el firmware ande:
// eso lo hacen los tests de compilacion real (opt-in, `TECNIA_CODEGEN_PIO=1`).
//
// Si el backend empieza a usar otra funcion del core, la compilacion de estos tests falla por
// «no declarado»: se agrega aca, a proposito.
#ifndef TECNIA_H02_ARDUINO_MINIMO_H
#define TECNIA_H02_ARDUINO_MINIMO_H

#include <stdint.h>

#define HIGH 0x1
#define LOW 0x0
#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2

void pinMode(uint8_t pin, uint8_t modo);
void digitalWrite(uint8_t pin, uint8_t valor);
int digitalRead(uint8_t pin);
unsigned long millis(void);
unsigned long micros(void);
void delayMicroseconds(unsigned int us);
void noInterrupts(void);
void interrupts(void);

void setup(void);
void loop(void);

#endif
