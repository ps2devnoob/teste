const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            windowBits: 13,
            level: 3
        },
        zlibInflateOptions: {
            chunkSize: 1024,
            windowBits: 13,
            level: 3
        },
        threshold: 1024,
        concurrencyLimit: 10,
        clientMaxWindowBits: 13,
        serverMaxWindowBits: 13,
        serverMaxNoContextTakeover: false,
        clientMaxNoContextTakeover: false,
        compress: true,
        zlibInflateOptions: {
            chunkSize: 1024,
            windowBits: 13,
            level: 3
        }
    }
});

class GameServer {
    constructor() {
        this.players = new Map();
        this.connections = new Map();
        this.gameState = {
            players: {},
            maxPlayers: 8,
            gameTime: 0
        };
        this.gameLoop = null;
        this.tickRate = 20;
        this.nextPlayerId = 1;
        this.connectionTimeout = 45000;
        this.messageQueue = [];
        this.startGameLoop();
    }

    generateUniquePlayerId() {
        let playerId;
        do {
            playerId = this.nextPlayerId++;
        } while (this.players.has(playerId.toString()));
        return playerId.toString();
    }

    startGameLoop() {
        this.gameLoop = setInterval(() => {
            this.gameState.gameTime += 1000 / this.tickRate;
            this.cleanupInactivePlayers();
            this.processMessageQueue();
            this.broadcastGameState();
        }, 1000 / this.tickRate);
    }

    cleanupInactivePlayers() {
        const now = Date.now();
        const playersToRemove = [];
        
        for (let [playerId, player] of this.players) {
            if (now - player.lastUpdate > this.connectionTimeout) {
                console.log(`Player ${playerId} removido por inatividade`);
                playersToRemove.push(playerId);
            }
        }
        
        playersToRemove.forEach(playerId => {
            this.removePlayer(playerId);
        });
    }

    processMessageQueue() {
  
        const messagesToProcess = this.messageQueue.splice(0, 50);
        
        messagesToProcess.forEach(({ ws, playerId, message }) => {
            this.handleMessage(ws, playerId, message);
        });
    }

    addPlayer(ws, playerId) {
        try {
       

            if (this.players.has(playerId)) {
                console.log(`Jogador ${playerId} já existe, removendo conexão anterior`);
                const oldPlayer = this.players.get(playerId);
                if (oldPlayer.ws && oldPlayer.ws.readyState === WebSocket.OPEN) {
                    oldPlayer.ws.close(1000, 'Reconnecting');
                }
                this.removePlayer(playerId);
            }

            const player = {
                id: playerId,
                ws: ws,
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                animation: "root|Idle",
                connected: true,
                lastUpdate: Date.now(),
                speed: 0.3,
                color: this.generatePlayerColor(playerId),
                connectionId: crypto.randomUUID(),
                messagesSent: 0,
                messagesReceived: 0
            };

            this.players.set(playerId, player);
            this.connections.set(ws, playerId);
            
            this.gameState.players[playerId] = {
                id: playerId,
                position: player.position,
                rotation: player.rotation,
                animation: player.animation,
                color: player.color
            };

            console.log(`Player ${playerId} conectado. Total: ${this.players.size}`);
            
  
            this.sendSafeMessage(ws, {
                type: 'player_connected',
                playerId: playerId,
                totalPlayers: this.players.size,
                gameState: this.gameState,
                serverTime: Date.now()
            });

      
            setTimeout(() => {
                this.broadcastPlayerJoined(playerId);
            }, 100);

        } catch (error) {
            console.error(`Erro ao adicionar player ${playerId}:`, error);
        }
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            try {
                this.connections.delete(player.ws);
                this.players.delete(playerId);
                delete this.gameState.players[playerId];
                
                console.log(`Player ${playerId} desconectado. Total: ${this.players.size}`);
                
             
                if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                    player.ws.close(1000, 'Disconnected');
                }
                
               
                setTimeout(() => {
                    this.broadcastPlayerLeft(playerId);
                }, 100);
                
            } catch (error) {
                console.error(`Erro ao remover player ${playerId}:`, error);
            }
        }
    }

    updatePlayerPosition(playerId, data) {
        const player = this.players.get(playerId);
        if (player) {
   
            if (data.position && typeof data.position === 'object' &&
                data.rotation && typeof data.rotation === 'object') {
                
                player.position = data.position;
                player.rotation = data.rotation;
                player.animation = data.animation || "root|Idle";
                player.lastUpdate = Date.now();

                this.gameState.players[playerId] = {
                    id: playerId,
                    position: player.position,
                    rotation: player.rotation,
                    animation: player.animation,
                    color: player.color
                };
            }
        }
    }

    sendSafeMessage(ws, data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                const message = JSON.stringify(data);
                ws.send(message);
                
           
                const playerId = this.connections.get(ws);
                if (playerId) {
                    const player = this.players.get(playerId);
                    if (player) {
                        player.messagesSent++;
                    }
                }
                
                return true;
            } catch (error) {
                console.error('Erro ao enviar mensagem:', error);
                return false;
            }
        }
        return false;
    }

    broadcastGameState() {
        if (this.players.size === 0) return;
        
        const message = {
            type: 'game_state',
            gameState: this.gameState,
            timestamp: Date.now()
        };

        const playersToRemove = [];
        
        this.players.forEach((player, playerId) => {
            if (!this.sendSafeMessage(player.ws, message)) {
                playersToRemove.push(playerId);
            }
        });


        playersToRemove.forEach(playerId => {
            this.removePlayer(playerId);
        });
    }

    broadcastPlayerJoined(playerId) {
        const playerData = this.gameState.players[playerId];
        if (!playerData) return;

        const message = {
            type: 'player_joined',
            playerId: playerId,
            playerData: playerData,
            totalPlayers: this.players.size,
            timestamp: Date.now()
        };

        const playersToRemove = [];

        this.players.forEach((player, id) => {
            if (id !== playerId) {
                if (!this.sendSafeMessage(player.ws, message)) {
                    playersToRemove.push(id);
                }
            }
        });

        playersToRemove.forEach(id => {
            this.removePlayer(id);
        });
    }

    broadcastPlayerLeft(playerId) {
        const message = {
            type: 'player_left',
            playerId: playerId,
            totalPlayers: this.players.size,
            timestamp: Date.now()
        };

        const playersToRemove = [];

        this.players.forEach((player, id) => {
            if (!this.sendSafeMessage(player.ws, message)) {
                playersToRemove.push(id);
            }
        });

        playersToRemove.forEach(id => {
            this.removePlayer(id);
        });
    }

    generatePlayerColor(playerId) {
        const colors = [
            [255, 0, 0],    
            [0, 255, 0],    
            [0, 0, 255],    
            [255, 255, 0],  
            [255, 0, 255],  
            [0, 255, 255],  
            [255, 128, 0],  
            [128, 0, 255]   
        ];
        const index = parseInt(playerId) % colors.length;
        return colors[index];
    }

    handleMessage(ws, playerId, message) {
        try {
            const data = JSON.parse(message);
            
            if (!this.players.has(playerId)) {
                console.log(`Mensagem de jogador inexistente: ${playerId}`);
                return;
            }
            
            const player = this.players.get(playerId);
            player.lastUpdate = Date.now();
            player.messagesReceived++;
            
            switch (data.type) {
                case 'position_update':
                    this.updatePlayerPosition(playerId, data);
                    break;
                    
                case 'ping':
                    this.sendSafeMessage(ws, {
                        type: 'pong',
                        timestamp: data.timestamp,
                        serverTime: Date.now()
                    });
                    break;
                    
                case 'system_info':
                    console.log(`Player ${playerId} system info:`, {
                        platform: data.platform,
                        runtime: data.runtime,
                        network: data.network
                    });
                    this.sendSafeMessage(ws, {
                        type: 'system_info_received',
                        message: 'System info received successfully'
                    });
                    break;
                    
                case 'disconnect':
                    console.log(`Player ${playerId} enviou disconnect`);
                    this.removePlayer(playerId);
                    break;
                    
                case 'heartbeat':
                    this.sendSafeMessage(ws, {
                        type: 'heartbeat_response',
                        timestamp: Date.now()
                    });
                    break;
                    
                default:
                    console.log(`Tipo de mensagem desconhecido: ${data.type}`);
            }
        } catch (error) {
            console.error(`Erro handling message from player ${playerId}:`, error);
        }
    }

    queueMessage(ws, playerId, message) {
        this.messageQueue.push({ ws, playerId, message });
    }

    getServerStats() {
        return {
            players: this.players.size,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            messageQueue: this.messageQueue.length,
            gameTime: this.gameState.gameTime
        };
    }
}

const gameServer = new GameServer();


wss.on('connection', (ws, req) => {
    const playerId = gameServer.generateUniquePlayerId();
    const clientIP = req.connection.remoteAddress || req.socket.remoteAddress;
    
    console.log(`Nova conexão WebSocket - Player ID: ${playerId} - IP: ${clientIP}`);
    

    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
 
    gameServer.sendSafeMessage(ws, {
        type: 'welcome',
        message: `Bem-vindo ao servidor multiplayer! Você é o jogador ${playerId}`,
        playerId: playerId,
        serverTime: Date.now()
    });

  
    setTimeout(() => {
        gameServer.addPlayer(ws, playerId);
    }, 100);


    ws.on('message', (message) => {
        try {
            gameServer.queueMessage(ws, playerId, message.toString());
        } catch (error) {
            console.error(`Erro ao processar mensagem do player ${playerId}:`, error);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`WebSocket fechado - Player ${playerId} - Code: ${code}, Reason: ${reason}`);
        gameServer.removePlayer(playerId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error para player ${playerId}:`, error);
        gameServer.removePlayer(playerId);
    });
});

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            const playerId = gameServer.connections.get(ws);
            if (playerId) {
                console.log(`Conexão morta detectada para player ${playerId}`);
                gameServer.removePlayer(playerId);
            }
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);


server.on('request', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(gameServer.getServerStats()));
    } else if (req.url === '/players') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const playerList = Array.from(gameServer.players.keys());
        res.end(JSON.stringify({
            players: playerList,
            total: gameServer.players.size,
            details: Array.from(gameServer.players.values()).map(p => ({
                id: p.id,
                lastUpdate: p.lastUpdate,
                messagesSent: p.messagesSent,
                messagesReceived: p.messagesReceived
            }))
        }));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Servidor Multiplayer PS2 rodando!\nJogadores conectados: ' + gameServer.players.size);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('=== Servidor Multiplayer PS2 ===');
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`WebSocket: ws://0.0.0.0:${PORT}`);
    console.log('Aguardando conexões...');
});


process.on('SIGINT', () => {
    console.log('\nDesligando servidor...');
    
    clearInterval(heartbeatInterval);
    
    const disconnectPromises = [];
    gameServer.players.forEach((player, playerId) => {
        disconnectPromises.push(new Promise((resolve) => {
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                player.ws.close(1000, 'Server shutting down');
                setTimeout(resolve, 100);
            } else {
                resolve();
            }
        }));
    });
    
    Promise.all(disconnectPromises).then(() => {
        wss.close(() => {
            server.close(() => {
                console.log('Servidor encerrado com sucesso');
                process.exit(0);
            });
        });
    });
});

process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promise rejeitada:', reason);
});
