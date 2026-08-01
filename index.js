const { Accessory, Characteristic, Service } = require('homebridge');
const HueBulb = require('philips-hue-ble');

class PhilipsHueBleAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.mac = config.address;
    this.name = config.name || 'Lâmpada Hue Bluetooth';
    this.bulb = null;
    this.connected = false;

    // Criar o serviço de lâmpada
    this.lightbulbService = new Service.Lightbulb(this.name);

    // Característica Ligar/Desligar
    this.onCharacteristic = this.lightbulbService
      .getCharacteristic(Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    // Característica Brilho
    this.brightnessCharacteristic = this.lightbulbService
      .getCharacteristic(Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this))
      .onGet(this.getBrightness.bind(this));

    // Serviço de Informação
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Philips')
      .setCharacteristic(Characteristic.Model, 'Hue Bluetooth')
      .setCharacteristic(Characteristic.SerialNumber, this.mac);

    // Lista de serviços para o Homebridge
    this.services = [this.lightbulbService, this.informationService];

    // Cache para evitar leituras constantes
    this._cachedOn = false;
    this._cachedBrightness = 100;
  }

  // ---------------------------
  // CONEXÃO BLUETOOTH
  // ---------------------------
  async connect() {
    if (this.bulb && this.connected) {
      return this.bulb;
    }

    try {
      this.log.info(`Conectando à lâmpada ${this.mac}...`);
      this.bulb = new HueBulb(this.mac);
      await this.bulb.init();
      this.connected = true;
      this.log.info(`Conectado com sucesso!`);
      return this.bulb;
    } catch (err) {
      this.log.error(`Falha na conexão: ${err.message}`);
      this.connected = false;
      throw new Error(`Bluetooth offline: ${err.message}`);
    }
  }

  // ---------------------------
  // GETTERS (para HomeKit)
  // ---------------------------
  async getOn() {
    try {
      const bulb = await this.connect();
      const state = await bulb.getPower();
      this._cachedOn = state;
      return state;
    } catch (err) {
      this.log.warn(`Falha ao ler estado (getOn): ${err.message}`);
      return this._cachedOn; // retorna último valor conhecido
    }
  }

  async getBrightness() {
    try {
      const bulb = await this.connect();
      const bri = await bulb.getBrightness();
      this._cachedBrightness = bri;
      return bri;
    } catch (err) {
      this.log.warn(`Falha ao ler brilho (getBrightness): ${err.message}`);
      return this._cachedBrightness;
    }
  }

  // ---------------------------
  // SETTERS (para HomeKit)
  // ---------------------------
  async setOn(value) {
    this.log(`Definindo estado: ${value ? 'LIGADO' : 'DESLIGADO'}`);
    try {
      const bulb = await this.connect();
      await bulb.setPower(value);
      this._cachedOn = value;
    } catch (err) {
      this.log.error(`Erro ao alterar estado: ${err.message}`);
      // Tenta reconectar na próxima vez
      this.connected = false;
      throw new Error('Falha ao alterar estado');
    }
  }

  async setBrightness(value) {
    this.log(`Definindo brilho: ${value}%`);
    try {
      const bulb = await this.connect();
      await bulb.setBrightness(value);
      this._cachedBrightness = value;
    } catch (err) {
      this.log.error(`Erro ao alterar brilho: ${err.message}`);
      this.connected = false;
      throw new Error('Falha ao alterar brilho');
    }
  }

  // ---------------------------
  // RETORNA SERVIÇOS
  // ---------------------------
  getServices() {
    return this.services;
  }
}

// Registra o accessory no Homebridge
module.exports = (api) => {
  api.registerAccessory('PhilipsHueBleAccessory', PhilipsHueBleAccessory);
};