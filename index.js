const noble = require('@abandonware/noble');

const MAC_LAMPADA = 'de4f22914d12'; // sem ":"
const SERVICE_UUID = '0000fe0f00001000800000805f9b34fb'; // corrigido
const CHAR_UUID    = '932c32bd000247a2835aa8d455b859dd'; // controle on/off

module.exports = (api) => {
  api.registerAccessory('homebridge-philips-hue-ble', 'HueBLE', HueBLE);
};

class HueBLE {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.name = config.name || 'Hue Bluetooth';
    this.peripheral = null;
    this.isConnecting = false;

    this.service = new this.Service.Lightbulb(this.name);
    this.service.getCharacteristic(this.Characteristic.On)
      .onSet(this.setOn.bind(this));

    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn' && !this.peripheral) {
        await noble.startScanningAsync([SERVICE_UUID], false);
      }
    });

    noble.on('discover', (peripheral) => {
      // usa peripheral.address para comparação segura
      if (this.peripheral) return;
      const addr = (peripheral.address || '').replace(/:/g, '').toLowerCase();
      if (addr === MAC_LAMPADA) {
        this.log.info('Lâmpada encontrada:', addr);
        noble.stopScanningAsync();
        this.peripheral = peripheral;
      }
    });
  }

  async setOn(value) {
    if (!this.peripheral) {
      this.log.warn('Lâmpada não disponível');
      return;
    }
    if (this.isConnecting) return;
    this.isConnecting = true;

    const command = value ? Buffer.from('020101', 'hex') : Buffer.from('020100', 'hex');

    try {
      await this.peripheral.connectAsync();
      const { characteristics } = await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [SERVICE_UUID], [CHAR_UUID]
      );
      const char = characteristics.find(c => c.uuid === CHAR_UUID);
      if (!char) throw new Error('Característica não encontrada');

      await char.writeAsync(command, false); // false = sem resposta
      this.log.info(`Lâmpada ${value ? 'ligada' : 'desligada'}`);
    } catch (err) {
      this.log.error('Erro:', err.message);
    } finally {
      this.isConnecting = false;
      try { await this.peripheral.disconnectAsync(); } catch (e) {}
    }
  }

  getServices() {
    return [this.service];
  }
}