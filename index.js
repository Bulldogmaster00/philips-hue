const noble = require('@abandonware/noble');

// UUIDs GATT da Philips Hue Bluetooth
const HUE_SERVICE_UUID = '932c32bd-0000-47a2-835a-a8d455b859dd';
const HUE_CHARACTERISTIC_UUID = '932c32bd-0001-47a2-835a-a8d455b859dd';

// Comandos
const CMD_ON = Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
const CMD_OFF = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
const CMD_BRIGHTNESS = (level) => {
  const buf = Buffer.alloc(6);
  buf[0] = 0x01;
  buf[1] = 0x01;
  buf[2] = level;
  buf[3] = 0x00;
  buf[4] = 0x00;
  buf[5] = 0x00;
  return buf;
};

let Service, Characteristic;

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  api.registerAccessory('PhilipsHueBle', PhilipsHueBleAccessory);
};

class PhilipsHueBleAccessory {
  constructor(log, config) {
    this.log = log;
    this.config = config;
    this.name = config.name || 'Philips Hue Bulb';
    this.address = config.address || null;
    this.timeout = null;
    this.characteristic = null;
    this.peripheral = null;

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

    if (!this.address) {
      this.log('No address provided, starting BLE discovery...');
      this.startDiscovery();
    } else {
      this.log(`Using fixed address: ${this.address}`);
      this.connectToDevice(this.address);
    }
  }

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

    setTimeout(() => {
      noble.stopScanning();
      this.log('Discovery timeout. No Hue bulb found.');
    }, 30000);
  }

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
          this.characteristic = characteristics[0];
          this.log('Ready to control the bulb.');
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

  scheduleReconnect() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.log('Attempting to reconnect...');
      this.connectToDevice(this.address);
    }, 5000);
  }

  readState() {
    if (!this.characteristic) return;
    this.characteristic.read((err, data) => {
      if (err) {
        this.log('Failed to read state.');
        return;
      }
      if (data && data.length >= 3) {
        const isOn = data[1] === 1;
        const brightness = data[2];
        this.lightbulbService.updateCharacteristic(Characteristic.On, isOn);
        this.lightbulbService.updateCharacteristic(Characteristic.Brightness, brightness);
        this.log(`State: ${isOn ? 'On' : 'Off'}, Brightness: ${brightness}`);
      }
    });
  }

  sendCommand(cmd, callback) {
    if (!this.characteristic) {
      callback(new Error('Not connected'));
      return;
    }
    this.characteristic.write(cmd, false, (err) => {
      if (err) {
        this.log(`Write error: ${err.message}`);
        callback(err);
      } else {
        callback(null);
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

  getServices() {
    return this.services;
  }
}