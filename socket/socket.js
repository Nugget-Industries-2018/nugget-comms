/**
 * botSocket.js
 * an API for talking to the robot
 *
 * Nugget Industries
 * 2017
 */

// dependencies
const net = require('net');
const EventEmitter = require('events');
const { nugLog } = require('nugget-logger');
const protocol = require('../protocol/protocol');
const { responseTypes } = protocol;

// set up logger
const logger = new nugLog('debug', 'botSocket.log');

// emitter is used to emit responses from the robot with the event type being the response's transactionID.
const emitter = new EventEmitter();

module.exports = class extends EventEmitter {

    constructor() {
        super();
        // set up magData event listener
        // is this the right place to set this up? only time will tell...
        emitter.on(responseTypes.MAGDATA, data => this.emit('magData', data.body));
        emitter.on(responseTypes.PITEMPDATA, data => this.emit('piTempData', data.body));
        emitter.on(responseTypes.MOTORDATA, data => this.emit('motorData', data.body));
    }

    async connect(options) {
        // if we're busy connecting
        if (this._isConnecting) {
            logger.w('connection', 'still connecting');
            return;
        }
        // if the socket is already established resolve and do nothing
        if (this._isConnected) {
            logger.w('connection', 'already connected');
            return;
        }
        // moderately ghetto semaphore
        this._isConnecting = true;
        await new Promise((resolve, reject) => {
            logger.i('connection', `connecting to bot at ${options.host}:${options.port}`);

            // combination connection creation and connection listener :dab:
            const socket = net.createConnection(options, () => {
                logger.i('connection', 'connected');
                this._isConnecting = false;
                this._isConnected = true;
                resolve();
            });
            socket.on('error', error => {
                logger.e('connection error', error);
                reject(error);
            });

            socket.on('data', this._onData);
            socket.on('close', this._onClose.bind(this));

            this._socket = socket;

        }).catch(error =>
            logger.e('disconnection error', error)
        );
    }

    _onData(data) {
        /*
         * emit transactionID event with data as callback parameter
         * sometimes data comes in all stuck together so we have to split it up
         */
        data.toString().replace(/}{/g, '}|{').split('|').forEach(datum => {
            try {
                datum = JSON.parse(datum);
                emitter.emit(datum.headers.transactionID, datum);
            }
            catch (error) {
                console.error(error);
            }
        })
    }

    _onClose(hadError) {
        if (hadError)
            logger.w('disconnection', 'disconnected with error');
        else
            logger.i('disconnection', 'disconnected');

        this._isConnected = false;
        delete this._socket;
    }

    disconnect() {
        // do nothing if we're not connected to anything
        if (!this._isConnected) {
            logger.w('disconnection', 'You\'re not even connected to anything');
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this._socket.end();
            this._socket.on('close', hadError => {
                resolve(hadError);
            });
        });
    }

    /**
     * Send some arbitrary data to the robot, expect the same arbitrary data in return
     * @param data - The arbitrary data to be echoed
     * @returns {Promise<*>}
     */
    echo(data) {
        return this.sendToken(new protocol.echoToken(data));
    }

    /**
     * Read the magnetometer values from the robot
     * @returns {Promise<*>}
     * {
     *    heading,
     *    pitch,
     *    roll
     * }
     */
    readMag() {
        return this.sendToken(new protocol.readMagToken());
    }

    /**
     * Tell the robot to start streaming magnetometer data at a certain frequency
     * @param interval - The interval to stream at (time in ms between data being sent)
     * @returns {Promise<*>}
     */
    startMagStream(interval) {
        return this.sendToken(new protocol.startMagStreamToken(interval));
    }

    /**
     * Tell the robot to stop streaming magnetometer data
     * @returns {Promise<*>}
     */
    stopMagStream() {
        return this.sendToken(new protocol.stopMagStreamToken());
    }

    /**
     * Send controller data to the robot
     * @param data - YER DATA U BITCH
     * @returns {Promise<*>} - Resolves with the robot's motor values as pulse length per motor in microseconds
     */
    sendControllerData(data) {
        return this.sendToken(new protocol.controllerDataToken(data));
    }

    /**
     * Gets the pi's CPU temperature in degrees Celcius
     * @returns {Promise<*>} - resolves with temperature
     */
    readPiTemp() {
        return this.sendToken(new protocol.readPiTempToken());
    }

    /**
     * Tells the robot to send the pi's CPU temeperature every ${interval} ms
     * @param interval - time in ms between robot sending temperature
     * @returns {Promise<*>}
     */
    startPiTempStream(interval) {
        return this.sendToken(new protocol.startPiTempStreamToken(interval));
    }

    /**
     * Tells the robot to stop streaming temperature data
     * @returns {Promise<*>}
     */
    stopPiTempStream() {
        return this.sendToken(new protocol.stopPiTempStreamToken());
    }

    /**
     * Tells the ROV to start or stop maintaining its current depth
     * @param value - true or false
     * @returns {Promise<*>}
     */
    setDepthLock(value) {
        return this.sendToken(new protocol.setDepthLockToken(value));
    }

    /**
     * FUNK OUTTA HERE
     * @param brightness
     * @returns {Promise<*>}
     */
    sendLEDTestData(brightness) {
        return this.sendToken(new protocol.LEDTestToken(brightness));
    }

    /**
     * Change constants for PID loop on-robot
     * @param zKp - proportional constant
     * @param zKi - integral constant
     * @param zKd - derivative constant
     * @returns {Promise<*>}
     */
    tunePIDLoop(zKp, zKi, zKd) {
        return this.sendToken(new protocol.PIDTuneToken({ zKp: zKp, zKi: zKi, zKd: zKd }));
    }

    /**
     * Send a special surprise to the robot
     * @param type - what kind of surprise is it?
     * @param body - ooh I'm so excited!!
     * @returns {Promise<*>}
     */
    specialDelivery(type, body) {
        return this.sendToken(new protocol.specialToken(type, body));
    }

    /**
     * Send a token and wait for its unique response from the robot
     *
     * @param token - the token to be sent
     * @returns {Promise<*>}
     */
    sendToken(token) {
        if (!this._isConnected) {
            logger.d('sendToken', 'YOU\'RE NOT CONNECTED YOU FUCKING BITCH');
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            // set listener for response
            emitter.once(token.headers.transactionID, data => {
                resolve(data);
            });
            // send it!!!!
            logger.d('sendToken', `sending it: ${JSON.stringify(token)}`);
            this._socket.write(token.stringify());
            // reject after 5 seconds and remove listener
            setTimeout(() => {
                logger.e('sendToken', `response from robot ${token.headers.transactionID} timed out after 5 seconds`);
                emitter.removeAllListeners(token.headers.transactionID);
                reject();
            }, 5000);
        });
    }

};
