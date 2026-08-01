const noble = require('@abandonware/noble');

const MAC_LAMPADA = 'de4f22914d12'; // Seu MAC (sem ":")
const HUE_SERVICE_UUID = '0000fe95-0000-1000-8000-00805f9b34fb';

module.exports = (api) => {
  api.registerAccessory('MeuPluginHueBLE', 'MinhaLampadaBLE');
};

class MinhaLampadaBLE {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.peripheral = null; // Guarda a referência da lâmpada
    this.isConnecting = false; // Evita tentar conectar duas vezes ao mesmo tempo

    // Serviço da lâmpada no HomeKit
    this.lightbulbService = new this.Service.Lightbulb(this.config.name);
    this.lightbulbService.getCharacteristic(this.Characteristic.On)
      .onSet(this.setOn.bind(this));

    this.log.info("✅ Plugin carregado! Aguardando lâmpada...");

    // REGISTRA OS EVENTOS DO BLE UMA ÚNICA VEZ AQUI (NO CONSTRUTOR)
    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        // Começa a procurar só se ainda não tiver uma lâmpada guardada
        if (!this.peripheral) {
          await noble.startScanningAsync([HUE_SERVICE_UUID], true);
        }
      }
    });

    noble.on('discover', (peripheral) => {
      // Se já temos uma lâmpada guardada, ignora
      if (this.peripheral) return;

      if (peripheral.uuid === MAC_LAMPADA) {
        this.log("🔍 Lâmpada encontrada no BLE!");
        noble.stopScanningAsync();
        this.peripheral = peripheral; // Salva a lâmpada na memória
      }
    });
  }

  // Chamado pelo app Casa do iOS
  async setOn(value) {
    this.log(`📱 Comando recebido: ${value ? 'LIGAR' : 'DESLIGAR'}`);

    // Se ainda não encontrou a lâmpada, não faz nada
    if (!this.peripheral) {
      this.log("❌ Erro: A lâmpada ainda não foi encontrada pelo BLE!");
      return;
    }

    // Evita múltiplas conexões simultâneas
    if (this.isConnecting) {
      this.log("⚠️ Já estou tentando conectar, aguarde...");
      return;
    }
    this.isConnecting = true;

    const comando = value 
      ? '0c0e0100c089eb4278ef200c1fda4de9000000' 
      : '0c0e0100c089eb4278ef200c1fda4de9000001';
    const bufferComando = Buffer.from(comando, 'hex');

    this.peripheral.connect((error) => {
      if (error) {
        this.log('❌ Erro ao conectar:', error.message);
        this.isConnecting = false;
        return;
      }

      this.peripheral.discoverServices([HUE_SERVICE_UUID], (err, services) => {
        if (err || !services.length) {
          this.log('❌ Não encontrou o serviço da Hue');
          this.isConnecting = false;
          this.peripheral.disconnect();
          return;
        }

        services[0].discoverCharacteristics([], (err, chars) => {
          if (err || !chars.length) {
            this.log('❌ Não encontrou a característica');
            this.isConnecting = false;
            this.peripheral.disconnect();
            return;
          }

          // Envia o comando e desconecta depois
          const char = chars[0];
          char.write(bufferComando, true, (err) => {
            this.isConnecting = false; // Libera a trava
            if (err) {
              this.log(`❌ Erro ao enviar comando: ${err}`);
            } else {
              this.log(`✅ Lâmpada ${value ? 'LIGADA' : 'DESLIGADA'} com sucesso!`);
            }
            this.peripheral.disconnect(); // Desconecta pra não sobrecarregar o Bluetooth
          });
        });
      });
    });
  }

  getServices() {
    return [this.lightbulbService];
  }
}