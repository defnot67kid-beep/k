const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const vm = require('vm');

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ==================== FILE STORAGE SYSTEMS ====================
const EXE_STORAGE_DIR = path.join(__dirname, 'exe_files');
const GLTF_STORAGE_DIR = path.join(__dirname, 'gltf_files');
const EXE_INDEX_FILE = path.join(__dirname, 'exe_index.json');
const GLTF_INDEX_FILE = path.join(__dirname, 'gltf_index.json');

// Create directories and files if they don't exist
function ensureDirectories() {
    if (!fs.existsSync(EXE_STORAGE_DIR)) fs.mkdirSync(EXE_STORAGE_DIR, { recursive: true });
    if (!fs.existsSync(GLTF_STORAGE_DIR)) fs.mkdirSync(GLTF_STORAGE_DIR, { recursive: true });
    if (!fs.existsSync(EXE_INDEX_FILE)) fs.writeFileSync(EXE_INDEX_FILE, JSON.stringify({ files: [], nextId: 1 }, null, 2));
    if (!fs.existsSync(GLTF_INDEX_FILE)) fs.writeFileSync(GLTF_INDEX_FILE, JSON.stringify({ files: [], nextId: 1 }, null, 2));
}

ensureDirectories();

// Multer configurations
const exeStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, EXE_STORAGE_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '.exe')
});

const gltfStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, GLTF_STORAGE_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
    }
});

const uploadEXE = multer({ storage: exeStorage, limits: { fileSize: 500 * 1024 * 1024 } });
const uploadGLTF = multer({ 
    storage: gltfStorage, 
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.gltf', '.glb', '.obj', '.fbx', '.mtl'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowedTypes.includes(ext));
    }
});

// Helper functions for index files
function readExeIndex() { return JSON.parse(fs.readFileSync(EXE_INDEX_FILE)); }
function writeExeIndex(data) { fs.writeFileSync(EXE_INDEX_FILE, JSON.stringify(data, null, 2)); }
function readGltfIndex() { return JSON.parse(fs.readFileSync(GLTF_INDEX_FILE)); }
function writeGltfIndex(data) { fs.writeFileSync(GLTF_INDEX_FILE, JSON.stringify(data, null, 2)); }

// ==================== GAME RUNTIME SYSTEM ====================

// Store active game servers
const gameServers = new Map(); // gameId -> { players: Map(playerId -> playerData), serverScripts, remotes, worldState }

// RemoteEvents storage
const remotes = new Map(); // remoteName -> { serverListeners: [], clientListeners: [] }

// Player sessions
const playerSessions = new Map(); // socketId -> { playerId, username, displayName, gameId }

function getRemote(name) {
    if (!remotes.has(name)) {
        remotes.set(name, { serverListeners: [], clientListeners: [] });
    }
    return remotes.get(name);
}

// Fire client event to specific player
function fireClient(socket, remoteName, ...args) {
    if (socket && socket.connected) {
        socket.emit('remote:fireClient', {
            name: remoteName,
            args: args
        });
    }
}

// Fire client event to all players in a game
function fireAllClients(gameId, remoteName, ...args) {
    io.to(gameId).emit('remote:fireClient', {
        name: remoteName,
        args: args
    });
}

// Create Roblox-like game API for ServerScripts
function createGameAPI(gameId, playerManager) {
    return {
        gameId: gameId,
        
        GetService: function(serviceName) {
            const services = {
                ReplicatedStorage: {
                    WaitForChild: function(remoteName) {
                        const remote = getRemote(remoteName);
                        return {
                            FireAllClients: function(...args) {
                                fireAllClients(gameId, remoteName, ...args);
                                console.log(`[${gameId}] 🔥 FireAllClients: ${remoteName}`, args);
                            },
                            FireClient: function(player, ...args) {
                                if (player && player.socket) {
                                    fireClient(player.socket, remoteName, ...args);
                                    console.log(`[${gameId}] 🔥 FireClient to ${player.name}: ${remoteName}`, args);
                                }
                            },
                            OnServerEvent: function(callback) {
                                remote.serverListeners.push({ callback, gameId });
                                console.log(`[${gameId}] 📡 OnServerEvent registered: ${remoteName}`);
                            }
                        };
                    }
                },
                Players: {
                    GetPlayers: function() {
                        return playerManager.getAllPlayers();
                    },
                    GetPlayer: function(playerId) {
                        return playerManager.getPlayer(playerId);
                    },
                    PlayerAdded: {
                        Connect: function(callback) {
                            playerManager.onPlayerAdded(callback);
                        }
                    },
                    PlayerRemoved: {
                        Connect: function(callback) {
                            playerManager.onPlayerRemoved(callback);
                        }
                    }
                },
                Workspace: {
                    Parts: new Map(),
                    AddPart: function(partData) {
                        const partId = Math.random().toString(36).substring(2, 10);
                        this.Parts.set(partId, partData);
                        fireAllClients(gameId, 'PartAdded', { id: partId, data: partData });
                        return partId;
                    },
                    RemovePart: function(partId) {
                        this.Parts.delete(partId);
                        fireAllClients(gameId, 'PartRemoved', partId);
                    }
                },
                Chat: {
                    SendMessage: function(player, message) {
                        fireAllClients(gameId, 'ChatMessage', {
                            player: player.name,
                            message: message
                        });
                    }
                },
                RunService: {
                    Heartbeat: {
                        Connect: function(callback) {
                            const interval = setInterval(() => {
                                callback(1/60); // dt = 1/60
                            }, 1000/60);
                            return function disconnect() { clearInterval(interval); };
                        }
                    }
                }
            };
            return services[serviceName];
        },
        
        print: function(...args) {
            console.log(`[${gameId}] 📝`, ...args);
        },
        
        warn: function(...args) {
            console.warn(`[${gameId}] ⚠️`, ...args);
        },
        
        error: function(...args) {
            console.error(`[${gameId}] ❌`, ...args);
        }
    };
}

// Player manager for each game
class PlayerManager {
    constructor(gameId) {
        this.gameId = gameId;
        this.players = new Map(); // playerId -> { id, name, displayName, socket, data, joinedAt }
        this.playerAddedCallbacks = [];
        this.playerRemovedCallbacks = [];
    }
    
    addPlayer(socket, playerId, username, displayName) {
        const player = {
            id: playerId,
            name: username,
            displayName: displayName,
            socket: socket,
            data: new Map(), // Custom data storage
            joinedAt: Date.now()
        };
        this.players.set(playerId, player);
        
        // Fire callbacks
        this.playerAddedCallbacks.forEach(cb => cb(player));
        
        // Notify all players in the game
        fireAllClients(this.gameId, 'PlayerJoined', {
            id: playerId,
            name: displayName
        });
        
        return player;
    }
    
    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            this.players.delete(playerId);
            this.playerRemovedCallbacks.forEach(cb => cb(player));
            fireAllClients(this.gameId, 'PlayerLeft', playerId);
        }
    }
    
    getPlayer(playerId) {
        return this.players.get(playerId);
    }
    
    getAllPlayers() {
        return Array.from(this.players.values());
    }
    
    onPlayerAdded(callback) {
        this.playerAddedCallbacks.push(callback);
    }
    
    onPlayerRemoved(callback) {
        this.playerRemovedCallbacks.push(callback);
    }
    
    getPlayerCount() {
        return this.players.size;
    }
}

// Run ServerScripts for a game
function runServerScripts(gameId, scripts, playerManager) {
    const gameAPI = createGameAPI(gameId, playerManager);
    const results = [];
    
    for (const script of scripts) {
        try {
            // Create sandbox with Roblox-like API
            const sandbox = {
                ...gameAPI,
                // Script-specific variables
                script: {
                    Name: script.name,
                    Parent: { Name: "ServerScriptService" }
                },
                // Common globals
                setTimeout: setTimeout,
                setInterval: setInterval,
                clearTimeout: clearTimeout,
                clearInterval: clearInterval,
                console: {
                    log: (...args) => console.log(`[${gameId}][${script.name}]`, ...args),
                    warn: (...args) => console.warn(`[${gameId}][${script.name}]`, ...args),
                    error: (...args) => console.error(`[${gameId}][${script.name}]`, ...args)
                }
            };
            
            // Create context and run script
            vm.createContext(sandbox);
            const scriptCode = script.source || script.properties?.Source || '';
            
            // Add wrapper for automatic execution
            const wrappedCode = `
                (function() {
                    ${scriptCode}
                    
                    // Auto-execute if there's a main function or initialization
                    if (typeof init === 'function') init();
                    if (typeof start === 'function') start();
                    
                    // Return any exported functions
                    return {
                        onUpdate: typeof onUpdate === 'function' ? onUpdate : null,
                        onPlayerJoined: typeof onPlayerJoined === 'function' ? onPlayerJoined : null,
                        onPlayerLeft: typeof onPlayerLeft === 'function' ? onPlayerLeft : null
                    };
                })();
            `;
            
            const result = vm.runInContext(wrappedCode, sandbox);
            results.push({ script, result, sandbox });
            console.log(`✅ [${gameId}] Loaded ServerScript: ${script.name}`);
            
        } catch (error) {
            console.error(`❌ [${gameId}] Error in script ${script.name}:`, error);
            // Fire error to clients
            fireAllClients(gameId, 'ScriptError', {
                script: script.name,
                error: error.message
            });
        }
    }
    
    return results;
}

// Load game and start server
async function loadGame(gameId) {
    try {
        const games = readGames();
        const game = games.games.find(g => g.id === gameId);
        
        if (!game) {
            console.error(`❌ Game ${gameId} not found`);
            return null;
        }
        
        console.log(`🎮 Loading game: ${game.name} (${gameId})`);
        
        // Extract all ServerScripts from game data
        const serverScripts = [];
        
        function findScripts(objects, parentPath = '') {
            for (const obj of objects) {
                if (obj.type === 'Script' && obj.name) {
                    // Check if it's in ServerScriptService
                    const isServerScript = obj.parent === 'service_serverscriptservice' || 
                                          parentPath.includes('ServerScriptService');
                    if (isServerScript) {
                        serverScripts.push({
                            id: obj.id,
                            name: obj.name,
                            source: obj.properties?.Source || '',
                            properties: obj.properties
                        });
                    }
                }
                
                // Recursively check children
                if (obj.children && obj.children.length > 0) {
                    findScripts(obj.children, `${parentPath}/${obj.name}`);
                }
            }
        }
        
        if (game.gameData && game.gameData.objects) {
            findScripts(game.gameData.objects);
        }
        
        console.log(`📜 Found ${serverScripts.length} ServerScripts in ${game.name}`);
        
        // Create player manager for this game
        const playerManager = new PlayerManager(gameId);
        
        // Run all ServerScripts
        const scriptResults = runServerScripts(gameId, serverScripts, playerManager);
        
        // Store game server instance
        const gameServer = {
            id: gameId,
            name: game.name,
            gameData: game.gameData,
            playerManager: playerManager,
            scripts: scriptResults,
            remotes: remotes,
            startedAt: Date.now()
        };
        
        gameServers.set(gameId, gameServer);
        
        // Start update loop for game (60 FPS)
        let lastUpdate = Date.now();
        const updateInterval = setInterval(() => {
            const now = Date.now();
            const dt = Math.min(0.033, (now - lastUpdate) / 1000);
            lastUpdate = now;
            
            // Call onUpdate for all scripts that have it
            for (const scriptResult of scriptResults) {
                if (scriptResult.result && scriptResult.result.onUpdate) {
                    try {
                        scriptResult.result.onUpdate(dt);
                    } catch (error) {
                        console.error(`Error in onUpdate for ${scriptResult.script.name}:`, error);
                    }
                }
            }
        }, 1000 / 60);
        
        gameServer.updateInterval = updateInterval;
        
        console.log(`✅ Game server started for ${game.name} (${gameId})`);
        return gameServer;
        
    } catch (error) {
        console.error(`❌ Failed to load game ${gameId}:`, error);
        return null;
    }
}

function unloadGame(gameId) {
    const gameServer = gameServers.get(gameId);
    if (gameServer) {
        if (gameServer.updateInterval) clearInterval(gameServer.updateInterval);
        gameServers.delete(gameId);
        console.log(`🛑 Game server stopped: ${gameServer.name} (${gameId})`);
    }
}

// ==================== SOCKET.IO HANDLERS ====================
io.on('connection', (socket) => {
    console.log(`🔌 New connection: ${socket.id}`);
    
    let currentGameId = null;
    let currentPlayerId = null;
    
    // Join game
    socket.on('joinGame', async (data) => {
        const { gameId, playerId, username, displayName, sessionToken } = data;
        
        console.log(`🎮 Player ${displayName} (${username}) joining game ${gameId}`);
        
        // Load game if not already running
        let gameServer = gameServers.get(gameId);
        if (!gameServer) {
            gameServer = await loadGame(gameId);
            if (!gameServer) {
                socket.emit('joinError', { message: 'Game not found' });
                return;
            }
        }
        
        currentGameId = gameId;
        currentPlayerId = playerId || `player_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        
        // Add player to game
        const player = gameServer.playerManager.addPlayer(socket, currentPlayerId, username, displayName);
        
        // Store session info
        playerSessions.set(socket.id, {
            playerId: currentPlayerId,
            username: username,
            displayName: displayName,
            gameId: gameId
        });
        
        // Join socket room for this game
        socket.join(gameId);
        
        // Send initial game state to player
        socket.emit('gameJoined', {
            gameId: gameId,
            gameName: gameServer.name,
            playerId: currentPlayerId,
            players: gameServer.playerManager.getAllPlayers().map(p => ({
                id: p.id,
                name: p.displayName
            })),
            gameData: gameServer.gameData
        });
        
        console.log(`✅ ${displayName} joined game ${gameId} (Total players: ${gameServer.playerManager.getPlayerCount()})`);
    });
    
    // Fire Server event (Client -> Server)
    socket.on('remote:fireServer', (data) => {
        const { name, args } = data;
        const remote = getRemote(name);
        
        // Get player info
        const session = playerSessions.get(socket.id);
        if (!session) return;
        
        // Create player object for callback
        const player = {
            id: session.playerId,
            name: session.username,
            displayName: session.displayName,
            socket: socket,
            data: new Map()
        };
        
        // Execute all server listeners
        remote.serverListeners.forEach(listener => {
            try {
                listener.callback(player, ...(args || []));
            } catch (error) {
                console.error(`Error in remote listener for ${name}:`, error);
            }
        });
    });
    
    // Update player position (for movement synchronization)
    socket.on('playerUpdate', (data) => {
        if (currentGameId) {
            socket.to(currentGameId).emit('playerUpdate', {
                playerId: currentPlayerId,
                ...data
            });
        }
    });
    
    // Chat message
    socket.on('chatMessage', (data) => {
        if (currentGameId) {
            const session = playerSessions.get(socket.id);
            io.to(currentGameId).emit('chatMessage', {
                player: session?.displayName || 'Unknown',
                message: data.message,
                timestamp: Date.now()
            });
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log(`🔌 Disconnected: ${socket.id}`);
        
        const session = playerSessions.get(socket.id);
        if (session && session.gameId) {
            const gameServer = gameServers.get(session.gameId);
            if (gameServer) {
                gameServer.playerManager.removePlayer(session.playerId);
                console.log(`👋 Player ${session.displayName} left game ${session.gameId}`);
            }
        }
        
        playerSessions.delete(socket.id);
    });
});

// ==================== EXE API ENDPOINTS ====================
app.get('/api/exe/list', (req, res) => {
    try {
        const index = readExeIndex();
        res.json(index.files.map(f => ({ id: f.id, name: f.originalName, size: f.size, uploadedAt: f.uploadedAt })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/exe/upload', uploadEXE.single('exeFile'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file provided' });
        const index = readExeIndex();
        const newId = index.nextId || 1;
        index.files.push({
            id: newId,
            originalName: req.body.name || req.file.originalname,
            storedFilename: req.file.filename,
            size: req.file.size,
            uploadedAt: new Date().toISOString()
        });
        index.nextId = newId + 1;
        writeExeIndex(index);
        res.json({ success: true, id: newId, name: req.body.name || req.file.originalname });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/exe/download/:id', (req, res) => {
    try {
        const index = readExeIndex();
        const entry = index.files.find(f => f.id === parseInt(req.params.id));
        if (!entry) return res.status(404).json({ error: 'File not found' });
        const filePath = path.join(EXE_STORAGE_DIR, entry.storedFilename);
        res.download(filePath, entry.originalName);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/exe/:id', (req, res) => {
    try {
        const index = readExeIndex();
        const fileIndex = index.files.findIndex(f => f.id === parseInt(req.params.id));
        if (fileIndex === -1) return res.status(404).json({ error: 'File not found' });
        const entry = index.files[fileIndex];
        const filePath = path.join(EXE_STORAGE_DIR, entry.storedFilename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        index.files.splice(fileIndex, 1);
        writeExeIndex(index);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== GLTF/3D MODEL API ====================
app.get('/api/gltf/list', (req, res) => {
    try {
        const index = readGltfIndex();
        res.json({ success: true, files: index.files.map(f => ({ id: f.id, name: f.originalName, type: f.fileType, size: f.size, uploadedAt: f.uploadedAt })) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/gltf/upload', uploadGLTF.single('modelFile'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file provided' });
        const index = readGltfIndex();
        const newId = index.nextId || 1;
        const ext = path.extname(req.file.originalname).toLowerCase();
        index.files.push({
            id: newId,
            originalName: req.body.name || req.file.originalname,
            storedFilename: req.file.filename,
            fileType: ext.substring(1).toUpperCase(),
            size: req.file.size,
            uploadedAt: new Date().toISOString()
        });
        index.nextId = newId + 1;
        writeGltfIndex(index);
        res.json({ success: true, id: newId, name: req.body.name || req.file.originalname, type: ext.substring(1).toUpperCase() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/gltf/download/:id', (req, res) => {
    try {
        const index = readGltfIndex();
        const entry = index.files.find(f => f.id === parseInt(req.params.id));
        if (!entry) return res.status(404).json({ error: 'Model not found' });
        const filePath = path.join(GLTF_STORAGE_DIR, entry.storedFilename);
        res.download(filePath, entry.originalName);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/gltf/:id', (req, res) => {
    try {
        const index = readGltfIndex();
        const fileIndex = index.files.findIndex(f => f.id === parseInt(req.params.id));
        if (fileIndex === -1) return res.status(404).json({ error: 'Model not found' });
        const entry = index.files[fileIndex];
        const filePath = path.join(GLTF_STORAGE_DIR, entry.storedFilename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        index.files.splice(fileIndex, 1);
        writeGltfIndex(index);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== GAME STORAGE ====================
const GAMES_FILE = path.join(__dirname, 'games.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const INSTALLER_PATH = path.join(DOWNLOADS_DIR, 'TavianSetup.exe');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(GAMES_FILE)) fs.writeFileSync(GAMES_FILE, JSON.stringify({ games: [], nextId: 100000000 }, null, 2));

function readGames() { return JSON.parse(fs.readFileSync(GAMES_FILE)); }
function writeGames(data) { fs.writeFileSync(GAMES_FILE, JSON.stringify(data, null, 2)); }
function generateGameId() {
    const games = readGames();
    let newId = games.nextId || 100000000;
    games.nextId = newId + 1;
    writeGames(games);
    return newId.toString();
}

// ==================== GAME API ENDPOINTS ====================
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Tavian Studio API with Socket.IO Game Server',
        activeGames: gameServers.size,
        activePlayers: playerSessions.size,
        endpoints: {
            exe: 'GET/POST/DELETE /api/exe/*',
            gltf: 'GET/POST/DELETE /api/gltf/*',
            games: 'GET/POST/DELETE /api/games/*',
            socket: 'Socket.IO connection for real-time gameplay'
        }
    });
});

app.post('/api/games/publish', (req, res) => {
    try {
        const { gameName, description, genre, subgenre, isPublic, thumbnail, gameData } = req.body;
        if (!gameName || !gameData) return res.status(400).json({ error: 'Game name and data required' });
        
        const gameId = generateGameId();
        const games = readGames();
        
        games.games.push({
            id: gameId,
            name: gameName.trim(),
            description: description || '',
            genre: genre || 'Other',
            subgenre: subgenre || '',
            isPublic: isPublic !== false,
            thumbnail: thumbnail || null,
            gameData: {
                version: gameData.version || "1.0",
                savedAt: gameData.savedAt || new Date().toISOString(),
                objects: gameData.objects || [],
                workspace: gameData.workspace || null
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            plays: 0,
            likes: 0
        });
        
        writeGames(games);
        res.json({ success: true, gameId: gameId, message: 'Game published successfully!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/games', (req, res) => {
    try {
        const games = readGames();
        const publicGames = games.games.filter(g => g.isPublic === true).map(g => ({
            id: g.id, name: g.name, description: g.description, genre: g.genre,
            thumbnail: g.thumbnail, createdAt: g.createdAt, plays: g.plays,
            likes: g.likes, objectCount: g.gameData?.objects?.length || 0
        }));
        publicGames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(publicGames);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/games/:gameId', (req, res) => {
    try {
        const games = readGames();
        const game = games.games.find(g => g.id === req.params.gameId);
        if (!game) return res.status(404).json({ error: 'Game not found' });
        
        game.plays = (game.plays || 0) + 1;
        writeGames(games);
        
        res.json({
            id: game.id, name: game.name, description: game.description,
            genre: game.genre, thumbnail: game.thumbnail,
            gameData: game.gameData, createdAt: game.createdAt,
            plays: game.plays, likes: game.likes
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/games/:gameId', (req, res) => {
    try {
        const games = readGames();
        const gameIndex = games.games.findIndex(g => g.id === req.params.gameId);
        if (gameIndex === -1) return res.status(404).json({ error: 'Game not found' });
        
        // Stop game server if running
        unloadGame(req.params.gameId);
        
        games.games.splice(gameIndex, 1);
        writeGames(games);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/active-games', (req, res) => {
    const activeGames = [];
    for (const [id, game] of gameServers) {
        activeGames.push({
            id: id,
            name: game.name,
            players: game.playerManager.getPlayerCount(),
            startedAt: game.startedAt
        });
    }
    res.json({ activeGames, totalPlayers: playerSessions.size });
});

app.get('/api/game-stats/:gameId', (req, res) => {
    const game = gameServers.get(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not active' });
    res.json({
        name: game.name,
        players: game.playerManager.getPlayerCount(),
        startedAt: game.startedAt,
        scriptsRunning: game.scripts.length
    });
});

app.post('/api/admin/stop-game/:gameId', (req, res) => {
    unloadGame(req.params.gameId);
    res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
    const games = readGames();
    const exeIndex = readExeIndex();
    const gltfIndex = readGltfIndex();
    res.json({
        games: { total: games.games.length, public: games.games.filter(g => g.isPublic === true).length, plays: games.games.reduce((sum, g) => sum + (g.plays || 0), 0) },
        exeFiles: { total: exeIndex.files.length },
        gltfFiles: { total: gltfIndex.files.length },
        activeServers: { games: gameServers.size, players: playerSessions.size }
    });
});

app.get('/download', (req, res) => {
    if (!fs.existsSync(INSTALLER_PATH)) return res.status(404).json({ error: 'Installer not found' });
    res.download(INSTALLER_PATH, 'TavianSetup.exe');
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ==================== START SERVER ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    🟣 Tavian Studio Game Server                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  📡 HTTP Server: http://0.0.0.0:${PORT}                                        ║
║  🔌 Socket.IO Server: ws://0.0.0.0:${PORT}                                     ║
║  🌐 Public URL: https://tavian-api.onrender.com                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  🎮 GAME SERVER FEATURES:                                                     ║
║  ✅ ServerScripts execution with vm2                                          ║
║  ✅ RemoteEvents (FireServer/FireClient)                                      ║
║  ✅ Real-time player synchronization                                          ║
║  ✅ Roblox-like API (GetService, WaitForChild)                                ║
║  ✅ 60 FPS update loop for scripts                                            ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  📚 AVAILABLE SERVICES IN SCRIPTS:                                            ║
║  • game.GetService("ReplicatedStorage")                                       ║
║  • game.GetService("Players") - GetPlayers, PlayerAdded/Removed              ║
║  • game.GetService("Workspace") - AddPart, RemovePart                         ║
║  • game.GetService("Chat") - SendMessage                                      ║
║  • game.GetService("RunService") - Heartbeat                                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  📡 REMOTEEVENT EXAMPLE:                                                      ║
║  const Coins = game.GetService("ReplicatedStorage").WaitForChild("Coins");    ║
║  Coins.OnServerEvent((player, amount) => {                                    ║
║      Coins.FireClient(player, player.data.get("coins") + amount);            ║
║  });                                                                          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
    `);
});
