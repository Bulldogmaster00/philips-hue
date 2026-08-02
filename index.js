const noble = require('@abandonware/noble');

const MAC_LAMPADA = 'de4f22914d12'; // sem ":"
const SERVICE_UUID = '932c32bd000047a2835aa8d455b859dd'; // serviço Hue BLE
const CHAR_UUID    = '932c32bd000247a2835aa8d455b859dd'; // característica on/off

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
        // sem filtro de serviço: nem todo periférico anuncia o UUID do serviço
        await noble.startScanningAsync([], true);
      }
    });

    noble.on('discover', (peripheral) => {
      if (this.peripheral) return;
      const addr = (peripheral.address || '').replace(/:/g, '').toLowerCase();
      if (addr === MAC_LAMPADA) {
        this.log.info('Lâmpada encontrada:', addr);
        noble.stopScanningAsync();
        this.peripheral = peripheral;
      }
    });

    // reconecta o scanner se a lâmpada cair
    noble.on('warning', (msg) => this.log.warn('noble warning:', msg));
  }

  async setOn(value) {
    if (!this.peripheral) {
      this.log.warn('Lâmpada não disponível');
      return;
    }
    if (this.isConnecting) return;
    this.isConnecting = true;

    const command = value ? Buffer.from('0101', 'hex') : Buffer.from('0100', 'hex');

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
      // limpa referência para permitir nova busca caso a conexão tenha falhado
      if (!this.peripheral.state || this.peripheral.state === 'disconnected') {
        // mantém peripheral em cache para reconexões futuras (evita novo scan)
      }
    }
  }

  getServices() {
    return [this.service];
  }
}
