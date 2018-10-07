const api = require('./air-conditioner-api');
const AirConditionerApi = api.AirConditionerApi;
const ACFun = api.ACFun;
const OpMode = api.OpMode;

var Service, Characteristic;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-samsung-air-conditioner", "Samsung AirConditioner", AirConditioner);
};

function AirConditioner(log, config) {
    this.log = log;
    this.name = config["name"];
    this.api = new AirConditionerApi(config["ip_address"], config["mac"], config["token"], log);

    this.targetState = null;
};

AirConditioner.prototype = {

    getServices: function() {
        this.log('Connecting...');

        this.api
            .on('error', this.log)
            .on('end', function() { this.log("Connection ended") }.bind(this))
            .on('authSuccess', function() { this.log("Connected") }.bind(this))
            .on('statusChange', this.statusChanged.bind(this));

        this.api.connect();

        this.acService = new Service.HeaterCooler(this.name);

        // ACTIVE STATE
        this.acService
            .getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));

        // CURRENT TEMPERATURE
        this.acService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: 1
            })
            .on('get', this.getCurrentTemperature.bind(this));

        // TARGET TEMPERATURE
        this.acService
            .getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 30,
                minStep: 1
            })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));

        this.acService
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 30,
                minStep: 1
            })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));

        // TARGET STATE
        this.acService
            .getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .on('get', this.getTargetState.bind(this))
            .on('set', this.setTargetState.bind(this));

        // CURRENT STATE
        this.acService
            .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', this.getCurrentState.bind(this))

        return [this.acService];
    },

    // ACTIVE STATE
    getActive: function(callback) {
        this.log('Getting active...');

        this.api.deviceState(ACFun.Power, function(err, power) {
            var isActive = power === 'On';
            this.log('Is active: ' + isActive);
            callback(err, isActive);
        }.bind(this));
    },

    setActive: function(isActive, callback) {
        this.log('Setting active: ' + isActive);

        this.api.deviceControl(ACFun.Power, isActive ? "On" : "Off", function(err) {
            this.log('Active set')
            callback();
        }.bind(this));
    },

    // CURRENT TEMPERATURE
    getCurrentTemperature: function(callback) {
        this.log('Getting current temperature...');
        
        this.api.deviceState(ACFun.TempNow, function(err, currentTemperature) {
            this.log('Current temperature: ' + currentTemperature);
            callback(err, currentTemperature);

            this.currentTemperature = currentTemperature;
        }.bind(this));
    },

    // TARGET TEMPERATURE
    getTargetTemperature: function(callback) {
        this.log('Getting target temperature...');

        this.api.deviceState(ACFun.TempSet, function(err, targetTemperature) {
            this.log('Target temperature: ' + targetTemperature);
            callback(err, targetTemperature);
            this.targetTemperature = targetTemperature;
        }.bind(this));
    },

    setTargetTemperature: function(temperature, callback) {
        this.log('Setting target temperature: ' + temperature);
        
        this.api.deviceControl(ACFun.TempSet, temperature, function(err) {
            this.log('Active set')
            callback(err);
        }.bind(this));
    },

    // TARGET STATE
    getTargetState: function(callback) {
        this.log('Getting target state...');

        this.api.deviceState(ACFun.OpMode, function(err, opMode) {
            this.targetState = this.targetStateFromOpMode(opMode);
            this.log('Target state: ' + this.targetState);
            callback(err, this.targetState);
        }.bind(this));
    },

    setTargetState: function(state, callback) {
        this.log('Setting target state: ' + state);
        
        this.api.deviceControl(ACFun.OpMode, this.opModeFromTargetState(state), function(err) {
            this.log('Target state set')
            this.targetState = state;
            callback(err);
        }.bind(this));
    },

    getCurrentState: function(callback) {
        callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
    },

    // STATUS CHANGE
    statusChanged: function(status) {
        this.log('Status change: ', status);

        var characteristic;
        var mappedValue = null;

        switch(status.name) {
        case ACFun.Power:
            characteristic = Characteristic.Active;
            mappedValue = status.value === "On";
            break;
        case ACFun.TempSet:
            characteristic = (this.targetState === Characteristic.TargetHeaterCoolerState.HEAT) ? Characteristic.HeatingThresholdTemperature : Characteristic.CoolingThresholdTemperature;
            this.targetTemperature = status.value;
            break;
        case ACFun.TempNow:
            characteristic = Characteristic.CurrentTemperature;
            this.currentTemperature = status.value
            break;
        case ACFun.OpMode:
            characteristic = Characteristic.TargetHeaterCoolerState;
            mappedValue = this.targetStateFromOpMode(status.value);
            this.targetState = mappedValue;
            break;
        }

        if(!!characteristic) {
            this.acService.getCharacteristic(characteristic).updateValue(mappedValue !== null ? mappedValue : status.value);
        }

        this.updateCurrentState();
    },

    updateCurrentState: function() {
        var state;
        if(this.currentTemperature > this.targetTemperature) {
            state = Characteristic.CurrentHeaterCoolerState.COOLING;
        } else if(this.currentTemperature < this.targetTemperature) {
            state = Characteristic.CurrentHeaterCoolerState.HEATING;
        } else {
            state = Characteristic.CurrentHeaterCoolerState.IDLE;
        }

        this.acService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(state);
        this.acService.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(this.targetTemperature);
        this.acService.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(this.targetTemperature);
    },

    opModeFromTargetState: function(targetState) {
        switch(targetState) {
            case Characteristic.TargetHeaterCoolerState.COOL: return OpMode.Cool;
            case Characteristic.TargetHeaterCoolerState.HEAT: return OpMode.Heat;
            case Characteristic.TargetHeaterCoolerState.AUTO: return OpMode.Auto;
        }
    },

    targetStateFromOpMode: function(targetState) {
        switch(targetState) {
            case OpMode.Cool: return Characteristic.TargetHeaterCoolerState.COOL;
            case OpMode.Heat: return Characteristic.TargetHeaterCoolerState.HEAT;
            case OpMode.Auto: return Characteristic.TargetHeaterCoolerState.AUTO;
        }
    }
};

