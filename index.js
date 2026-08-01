const HueLight = require('hue-light');

class PhilipsHueBleAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.mac = config.address;
    this.name = config.name || 'Lâmpada Hue Bluetooth';
    this.light = null;
    this.connected = false;

    // Cache para evitar leituras constantes
    this._cachedOn = false;
    this._cachedBrightness = 100;

    // Serviço da lâmpada
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

    // Informações do accessory
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Philips')
      .setCharacteristic(Characteristic.Model, 'Hue Bluetooth')
      .setCharacteristic(Characteristic.SerialNumber, this.mac);

    this.services = [this.lightbulbService, this.informationService];
  }

  // Conecta à lâmpada
  async connect() {
    if (this.light && this.connected) {
      return this.light;
    }

    try {
      this.log.info(`Conectando à lâmpada ${this.mac}...`);
      this.light = new HueLight(this.mac);
      await this.light.connect();
      this.connected = true;
      this.log.info(`Conectado com sucesso!`);
      return this.light;
    } catch (err) {
      this.log.error(`Falha na conexão: ${err.message}`);
      this.connected = false;
      throw err;
    }
  }

  // GET: estado ligado
  async getOn() {
    try {
      const light = await this.connect();
      const state = await light.getPower();
      this._cachedOn = state;
      return state;
    } catch (err) {
      this.log.warn(`Erro ao ler estado: ${err.message}`);
      return this._cachedOn;
    }
  }

  // GET: brilho
  async getBrightness() {
    try {
      const light = await this.connect();
      const bri = await light.getBrightness();
      this._cachedBrightness = bri;
      return bri;
    } catch (err) {
      this.log.warn(`Erro ao ler brilho: ${err.message}`);
      return this._cachedBrightness;
    }
  }

  // SET: ligar/desligar
  async setOn(value) {
    this.log(`Definindo estado: ${value ? 'LIGADO' : 'DESLIGADO'}`);
    try {
      const light = await this.connect();
      await light.setPower(value);
      this._cachedOn = value;
    } catch (err) {
      this.log.error(`Erro ao alterar estado: ${err.message}`);
      this.connected = false;
      throw err;
    }
  }

  // SET: brilho
  async setBrightness(value) {
    this.log(`Definindo brilho: ${value}%`);
    try {
      const light = await this.connect();
      await light.setBrightness(value);
      this._cachedBrightness = value;
    } catch (err) {
      this.log.error(`Erro ao alterar brilho: ${err.message}`);
      this.connected = false;
      throw err;
    }
  }

  getServices() {
    return this.services;
  }
}

// ====== REGISTRO NO HOMEBRIDGE ======
module.exports = (api) => {
  const { Accessory, Characteristic, Service } = api.hap;
  // Injeta as referências na classe
  PhilipsHueBleAccessory.prototype.Service = Service;
  PhilipsHueBleAccessory.prototype.Characteristic = Characteristic;
  api.registerAccessory('PhilipsHueBleAccessory', PhilipsHueBleAccessory);
};