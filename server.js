const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

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
        this.tickRate = 30;
        this.nextPlayerId = 1;
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
            this.broadcastGameState();
        }, 1000 / this.tickRate);
    }

    cleanupInactivePlayers() {
        const now = Date.now();
        const timeout = 30000;
        
        for (let [playerId, player] of this.players) {
            if (now - player.lastUpdate > timeout) {
                console.log(`Player ${playerId} removido por inatividade`);
                this.removePlayer(playerId);
            }
        }
    }

    addPlayer(ws, playerId) {
        if (this.players.has(playerId)) {
            console.log(`Jogador ${playerId} já existe, removendo conexão anterior`);
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
            connectionId: crypto.randomUUID()
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
        
        ws.send(JSON.stringify({
            type: 'player_connected',
            playerId: playerId,
            totalPlayers: this.players.size,
            gameState: this.gameState
        }));

        this.broadcastPlayerJoined(playerId);
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            this.connections.delete(player.ws);
            this.players.delete(playerId);
            delete this.gameState.players[playerId];
            
            console.log(`Player ${playerId} desconectado. Total: ${this.players.size}`);
            
            if (player.ws.readyState === WebSocket.OPEN) {
                player.ws.close();
            }
            
            this.broadcastPlayerLeft(playerId);
        }
    }

    updatePlayerPosition(playerId, data) {
        const player = this.players.get(playerId);
        if (player) {
            player.position = data.position;
            player.rotation = data.rotation;
            player.animation = data.animation;
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

    broadcastGameState() {
        const message = JSON.stringify({
            type: 'game_state',
            gameState: this.gameState
        });

        this.players.forEach((player, playerId) => {
            if (player.ws.readyState === WebSocket.OPEN) {
                try {
                    player.ws.send(message);
                } catch (error) {
                    console.error(`Erro ao enviar para player ${playerId}:`, error);
                    this.removePlayer(playerId);
                }
            }
        });
    }

    broadcastPlayerJoined(playerId) {
        const message = JSON.stringify({
            type: 'player_joined',
            playerId: playerId,
            playerData: this.gameState.players[playerId],
            totalPlayers: this.players.size
        });

        this.players.forEach((player, id) => {
            if (id !== playerId && player.ws.readyState === WebSocket.OPEN) {
                try {
                    player.ws.send(message);
                } catch (error) {
                    console.error(`Erro ao enviar player_joined para ${id}:`, error);
                    this.removePlayer(id);
                }
            }
        });
    }

    broadcastPlayerLeft(playerId) {
        const message = JSON.stringify({
            type: 'player_left',
            playerId: playerId,
            totalPlayers: this.players.size
        });

        this.players.forEach((player, id) => {
            if (player.ws.readyState === WebSocket.OPEN) {
                try {
                    player.ws.send(message);
                } catch (error) {
                    console.error(`Erro ao enviar player_left para ${id}:`, error);
                    this.removePlayer(id);
                }
            }
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
            
            switch (data.type) {
                case 'position_update':
                    this.updatePlayerPosition(playerId, data);
                    break;
                    
                case 'ping':
                    ws.send(JSON.stringify({
                        type: 'pong',
                        timestamp: data.timestamp,
                        serverTime: Date.now()
                    }));
                    break;
                    
                case 'chat':
                    this.broadcastChat(playerId, data.message);
                    break;
                    
                case 'system_info':
                    console.log(`Player ${playerId} system info:`, data);
                    ws.send(JSON.stringify({
                        type: 'system_info_received',
                        message: 'System info received successfully'
                    }));
                    break;
                    
                case 'disconnect':
                    console.log(`Player ${playerId} enviou disconnect`);
                    this.removePlayer(playerId);
                    break;
            }
        } catch (error) {
            console.error(`Erro handling message from player ${playerId}:`, error);
        }
    }

    broadcastChat(playerId, message) {
        const chatMessage = JSON.stringify({
            type: 'chat',
            playerId: playerId,
            message: message,
            timestamp: Date.now()
        });

        this.players.forEach((player, id) => {
            if (player.ws.readyState === WebSocket.OPEN) {
                try {
                    player.ws.send(chatMessage);
                } catch (error) {
                    console.error(`Erro ao enviar chat para ${id}:`, error);
                    this.removePlayer(id);
                }
            }
        });
    }
}

const gameServer = new GameServer();

wss.on('connection', (ws) => {
    const playerId = gameServer.generateUniquePlayerId();
    
    console.log(`Nova conexão WebSocket - Player ID: ${playerId}`);
    
    ws.send(JSON.stringify({
        type: 'welcome',
        message: `Bem-vindo ao servidor multiplayer! Você é o jogador ${playerId}`,
        playerId: playerId
    }));

    gameServer.addPlayer(ws, playerId);

    ws.on('message', (message) => {
        gameServer.handleMessage(ws, playerId, message.toString());
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


server.on('request', (req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'OK', 
            players: gameServer.players.size,
            uptime: process.uptime()
        }));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Servidor Multiplayer PS2 rodando!\nJogadores conectados: ' + gameServer.players.size);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=== Servidor Multiplayer PS2 ===`);
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`WebSocket: ws://0.0.0.0:${PORT}`);
    console.log(`Aguardando conexões...`);
});

process.on('SIGINT', () => {
    console.log('\nDesligando servidor...');
    gameServer.players.forEach((player, playerId) => {
        gameServer.removePlayer(playerId);
    });
    
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});