// ============================================================================
//  PROYECTO INTERNO DE VERIFICACION — compile-only, NO corre en hardware.
//
//  Incluye TODOS los headers del ecosistema Tecnia Bot y crea cada objeto
//  una sola vez, para que el coordinador verifique con `pio run` que cada
//  lib_deps del platformio.ini resuelve y compila (UNO y ESP32).
//
//  NO es un ejemplo didactico. Los pines son arbitrarios (solo para que
//  compile). Referencia humana: ../../docs/librerias.md
// ============================================================================

#include <Arduino.h>

// --- Nucleo / bundled: NO requieren lib_deps (vienen con el framework) ---
#include <Wire.h>              // I2C   (bundled en AVR y ESP32)
#include <SPI.h>               // SPI   (bundled en AVR y ESP32)
#include <EEPROM.h>            // EEPROM (bundled en AVR y ESP32)

// --- Requieren lib_deps, pero son PORTABLES (compilan en AVR y ESP32) ---
#include <Adafruit_Sensor.h>  // adafruit/Adafruit Unified Sensor
#include <DHT.h>              // adafruit/DHT sensor library
#include <Adafruit_BMP085.h>  // adafruit/Adafruit BMP085 Library
#include <Keypad.h>           // chris--a/Keypad
#include <Adafruit_GFX.h>     // adafruit/Adafruit GFX Library
#include <Adafruit_SSD1306.h> // adafruit/Adafruit SSD1306
#include <Adafruit_NeoPixel.h>// adafruit/Adafruit NeoPixel
#include <Adafruit_MPU6050.h> // adafruit/Adafruit MPU6050
#include <Stepper.h>          // arduino-libraries/Stepper (NO bundled)
#include <LiquidCrystal.h>    // arduino-libraries/LiquidCrystal (NO bundled)
#include <LiquidCrystal_I2C.h>// marcoschwartz/LiquidCrystal_I2C (LCD por I2C)

// --- Especifico por placa: la libreria del Servo cambia de nombre ----------
#if defined(ESP32)
  #include <ESP32Servo.h>     // madhephaestus/ESP32Servo  (solo ESP32)
  #include <WiFi.h>           // bundled en el framework espressif32 (solo ESP32)
#else
  #include <Servo.h>          // arduino-libraries/Servo    (solo AVR)
#endif

// ---------------------------------------------------------------------------
//  Un objeto por libreria (pines arbitrarios, solo para compilar)
// ---------------------------------------------------------------------------
DHT dht(2, DHT22);                                   // sensor DHT en pin 2
Adafruit_BMP085 bmp;                                 // BMP085/BMP180 por I2C
Adafruit_SSD1306 oled(128, 64, &Wire, -1);           // OLED 128x64 por I2C
Adafruit_NeoPixel tira(8, 6, NEO_GRB + NEO_KHZ800);  // 8 LEDs WS2812 en pin 6
Adafruit_MPU6050 mpu;                                // acelerometro por I2C

// Teclado matricial 4x4
const byte FILAS = 4;
const byte COLS  = 4;
char teclas[FILAS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte pinFilas[FILAS] = {14, 15, 16, 17};   // numeros de pin (validos en UNO y ESP32)
byte pinCols[COLS]   = {18, 19, 21, 22};
Keypad teclado = Keypad(makeKeymap(teclas), pinFilas, pinCols, FILAS, COLS);

Stepper motor(200, 9, 10, 11, 12);                   // paso a paso, 200 pasos/vuelta
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);               // LCD paralelo 16x2 (HD44780)
LiquidCrystal_I2C lcdI2C(0x27, 16, 2);               // LCD 16x2 por modulo I2C (dir 0x27)

Servo miServo;                                       // Servo (AVR) o ESP32Servo (ESP32)

void setup() {
  Serial.begin(115200);

  // Nucleo / bundled
  Wire.begin();
  SPI.begin();
  EEPROM.read(0);

  // Sensores
  dht.begin();
  bmp.begin();
  mpu.begin();

  // Display OLED
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  oled.clearDisplay();

  // NeoPixel
  tira.begin();
  tira.show();

  // LCD paralelo
  lcd.begin(16, 2);
  lcd.print("Tecnia Bot");

  // LCD por I2C
  lcdI2C.init();
  lcdI2C.backlight();
  lcdI2C.print("Tecnia Bot");

  // Motor paso a paso
  motor.setSpeed(15);

  // Teclado
  char t = teclado.getKey();
  (void)t;

  // Servo (pin distinto segun placa)
#if defined(ESP32)
  miServo.attach(13);
  WiFi.mode(WIFI_STA);   // WiFi solo existe en ESP32
#else
  miServo.attach(9);
#endif
  miServo.write(90);
}

void loop() {
  // compile-only: sin logica
}
