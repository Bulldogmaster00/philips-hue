const { Accessory, Service, Characteristic } = require('homebridge');
const noble = require('@abandonware/noble');

// UUIDs GATT da Philips Hue Bluetooth (engenharia reversa)
const HUE_SERVICE_UUID = '932c32bd-0000-47a2-835a-a8d455b859dd';
const HUE_CHARACTERISTIC_UUID = '932c32bd-0001-47a2-835a-a8d455b859dd';

// Comandos (formato little-endian)
const CMD_ON = Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
const CMD_OFF = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
const CMD_BRIGHTNESS = (level) => {
  const buf = Buffer.alloc(6);
  buf[0] = 0x01;
  buf[1] = 0x01;
  buf[2] = level; // 0-254 (0x00 a 0xFE)
  buf[3] = 0x00;
  buf[4] = 0x00;
  buf[5] = 0x00;
  return buf;
};

let peripheral = null;
let characteristic = null;

module.exports = (api) => {
  api.registerAccessory('PhilipsHueBle', PhilipsHueBleAccessory);
};

class PhilipsHueBleAccessory {
  constructor(log, config) {
    this.log = log;
    this.config = config;
    this.name = config.name || 'Philips Hue Bulb';
    this.address = config.address || null; // MAC ou UUID do dispositivo
    this.timeout = null;

    this.services = [];
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Philips')
      .setCharacteristic(Characteristic.Model, 'Hue BLE')
      .setCharacteristic(Characteristic.SerialNumber, this.address || 'unknown');

    this.lightbulbService = new Service.Lightbulb(this.name);
    this.lightbulbService.getCharacteristic(Characteristic.On)
      .on('set', this.setPower.bind(this))
      .on('get', this.getPower.bind(this));

    this.lightbulbService.getCharacteristic(Characteristic.Brightness)
      .on('set', this.setBrightness.bind(this))
      .on('get', this.getBrightness.bind(this));

    this.services = [this.informationService, this.lightbulbService];

    // Inicia a descoberta BLE se não tiver endereço fixo
    if (!this.address) {
      this.log('No address provided, starting BLE discovery...');
      this.startDiscovery();
    } else {
      this.log(`Using fixed address: ${this.address}`);
      this.connectToDevice(this.address);
    }
  }

  // === DESCOBERTA AUTOMÁTICA ===
  startDiscovery() {
    noble.on('stateChange', (state) => {
      if (state === 'poweredOn') {
        noble.startScanning([HUE_SERVICE_UUID], false);
        this.log('Scanning for Hue Bluetooth bulbs...');
      } else {
        noble.stopScanning();
      }
    });

    noble.on('discover', (periph) => {
      if (periph.advertisement.localName && periph.advertisement.localName.includes('Hue')) {
        this.log(`Found Hue bulb: ${periph.address} (${periph.advertisement.localName})`);
        this.address = periph.address;
        noble.stopScanning();
        this.connectToDevice(this.address);
      }
    });

    // Timeout após 30 segundos
    setTimeout(() => {
      noble.stopScanning();
      this.log('Discovery timeout. No Hue bulb found.');
    }, 30000);
  }

  // === CONEXÃO ===
  connectToDevice(address) {
    noble.connect(address, (err) => {
      if (err) {
        this.log(`Connection error: ${err.message}`);
        this.scheduleReconnect();
        return;
      }
      this.log('Connected to bulb!');

      noble.discoverServices(address, [HUE_SERVICE_UUID], (err, services) => {
        if (err || !services || services.length === 0) {
          this.log('Service not found.');
          this.scheduleReconnect();
          return;
        }
        const service = services[0];
        service.discoverCharacteristics([HUE_CHARACTERISTIC_UUID], (err, characteristics) => {
          if (err || !characteristics || characteristics.length === 0) {
            this.log('Characteristic not found.');
            this.scheduleReconnect();
            return;
          }
          characteristic = characteristics[0];
          this.log('Ready to control the bulb.');
          // Ao conectar, lê o estado atual
          this.readState();
        });
      });
    });

    noble.on('disconnect', (address) => {
      if (address === this.address) {
        this.log('Disconnected. Reconnecting...');
        this.scheduleReconnect();
      }
    });
  }

  // === RECONEXÃO ===
  scheduleReconnect() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.log('Attempting to reconnect...');
      this.connectToDevice(this.address);
    }, 5000);
  }

  // === LEITURA DO ESTADO ===
  readState() {
    if (!characteristic) return;
    characteristic.read((err, data) => {
      if (err) {
        this.log('Failed to read state.');
        return;
      }
      // O estado vem em 6 bytes: byte0=0x01, byte1=on/off, byte2=brilho
      if (data && data.length >= 3) {
        const isOn = data[1] === 1;
        const brightness = data[2]; // 0-254
        this.lightbulbService.updateCharacteristic(Characteristic.On, isOn);
        this.lightbulbService.updateCharacteristic(Characteristic.Brightness, brightness);
        this.log(`State: ${isOn ? 'On' : 'Off'}, Brightness: ${brightness}`);
      }
    });
  }

  // === COMANDOS ===
  sendCommand(cmd, callback) {
    if (!characteristic) {
      callback(new Error('Not connected'));
      return;
    }
    characteristic.write(cmd, false, (err) => {
      if (err) {
        this.log(`Write error: ${err.message}`);
        callback(err);
      } else {
        callback(null);
        // Atualiza o estado após o comando
        setTimeout(() => this.readState(), 500);
      }
    });
  }

  setPower(value, callback) {
    const cmd = value ? CMD_ON : CMD_OFF;
    this.log(`Setting power to ${value}`);
    this.sendCommand(cmd, callback);
  }

  getPower(callback) {
    // Retorna o valor atual em cache
    const current = this.lightbulbService.getCharacteristic(Characteristic.On).value;
    callback(null, current);
  }

  setBrightness(value, callback) {
    this.log(`Setting brightness to ${value}`);
    const cmd = CMD_BRIGHTNESS(value);
    this.sendCommand(cmd, callback);
  }

  getBrightness(callback) {
    const current = this.lightbulbService.getCharacteristic(Characteristic.Brightness).value;
    callback(null, current);
  }

  // === Homebridge REQUIRED ===
  getServices() {
    return this.services;
  }
}