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

// ==================== FIX 1: Use /tmp for Render.com persistent writable storage ====================
const USE_TMP = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
const BASE_STORAGE = USE_TMP ? '/tmp/tavian_storage' : __dirname;

// Create storage directories with proper paths
const EXE_STORAGE_DIR = path.join(BASE_STORAGE, 'exe_files');
const GLTF_STORAGE_DIR = path.join(BASE_STORAGE, 'gltf_files');
const EXE_INDEX_FILE = path.join(BASE_STORAGE, 'exe_index.json');
const GLTF_INDEX_FILE = path.join(BASE_STORAGE, 'gltf_index.json');
const GAMES_FILE = path.join(BASE_STORAGE, 'games.json');
const DOWNLOADS_DIR = path.join(BASE_STORAGE, 'downloads');
const INSTALLER_PATH = path.join(DOWNLOADS_DIR, 'TavianSetup.exe');

// Create HTTP server for Socket.IO with better transport
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ==================== FIX 2: Ensure directories exist with error handling ====================
function ensureDirectories() {
    const dirs = [EXE_STORAGE_DIR, GLTF_STORAGE_DIR, DOWNLOADS_DIR];
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            } catch (err) {
                console.error(`Failed to create ${dir}:`, err.message);
            }
        }
    }
    
    // Initialize JSON files if they don't exist
    const files = [
        { path: EXE_INDEX_FILE, default: { files: [], nextId: 1 } },
        { path: GLTF_INDEX_FILE, default: { files: [], nextId: 1 } },
        { path: GAMES_FILE, default: { games: [], nextId: 100000000 } }
    ];
    
    for (const file of files) {
        if (!fs.existsSync(file.path)) {
            try {
                fs.writeFileSync(file.path, JSON.stringify(file.default, null, 2));
                console.log(`📄 Created file: ${file.path}`);
            } catch (err) {
                console.error(`Failed to create ${file.path}:`, err.message);
            }
        }
    }
}

ensureDirectories();

// Multer configurations with error handling
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

// Helper functions with error handling
function readExeIndex() { 
    try {
        return JSON.parse(fs.readFileSync(EXE_INDEX_FILE)); 
    } catch (e) {
        return { files: [], nextId: 1 };
    }
}
function writeExeIndex(data) { 
    try {
        fs.writeFileSync(EXE_INDEX_FILE, JSON.stringify(data, null, 2)); 
    } catch (e) {
        console.error('Failed to write exe index:', e.message);
    }
}
function readGltfIndex() { 
    try {
        return JSON.parse(fs.readFileSync(GLTF_INDEX_FILE)); 
    } catch (e) {
        return { files: [], nextId: 1 };
    }
}
function writeGltfIndex(data) { 
    try {
        fs.writeFileSync(GLTF_INDEX_FILE, JSON.stringify(data, null, 2)); 
    } catch (e) {
        console.error('Failed to write gltf index:', e.message);
    }
}
function readGames() { 
    try {
        return JSON.parse(fs.readFileSync(GAMES_FILE)); 
    } catch (e) {
        return { games: [], nextId: 100000000 };
    }
}
function writeGames(data) { 
    try {
        fs.writeFileSync(GAMES_FILE, JSON.stringify(data, null, 2)); 
    } catch (e) {
        console.error('Failed to write games:', e.message);
    }
}
function generateGameId() {
    const games = readGames();
    let newId = games.nextId || 100000000;
    games.nextId = newId + 1;
    writeGames(games);
    return newId.toString();
}

// ==================== PURE SCRIPT EXECUTION ENGINE ====================

// Store active game servers
const gameServers = new Map();

// RemoteEvents storage
const remoteEvents = new Map();

// Module cache for ModuleScripts
const moduleCache = new Map();

// Get or create RemoteEvent
function getRemoteEvent(name) {
    if (!remoteEvents.has(name)) {
        remoteEvents.set(name, { serverListeners: [], clientListeners: [] });
    }
    return remoteEvents.get(name);
}

// Fire client event
function fireClient(socket, remoteName, ...args) {
    if (socket && socket.connected) {
        socket.emit('remote:fireClient', {
            name: remoteName,
            args: args
        });
    }
}

// Fire to all clients in a game
function fireAllClients(roomId, remoteName, ...args) {
    io.to(roomId).emit('remote:fireClient', {
        name: remoteName,
        args: args
    });
}

// ModuleScript loader and resolver
class ModuleResolver {
    constructor(gameId, gameAPI) {
        this.gameId = gameId;
        this.gameAPI = gameAPI;
        this.loadedModules = new Map();
    }
    
    require(moduleName, searchPath = null) {
        if (this.loadedModules.has(moduleName)) {
            return this.loadedModules.get(moduleName);
        }
        
        const gameServer = gameServers.get(this.gameId);
        if (!gameServer) return null;
        
        let moduleInstance = null;
        
        function findModule(objects, targetName) {
            for (const obj of objects) {
                if (obj.type === 'ModuleScript' && obj.name === targetName) {
                    return obj;
                }
                if (obj.children && obj.children.length > 0) {
                    const found = findModule(obj.children, targetName);
                    if (found) return found;
                }
            }
            return null;
        }
        
        if (gameServer.gameData && gameServer.gameData.objects) {
            moduleInstance = findModule(gameServer.gameData.objects, moduleName);
        }
        
        if (!moduleInstance) {
            console.warn(`[${this.gameId}] ModuleScript not found: ${moduleName}`);
            return null;
        }
        
        const sandbox = this.createModuleSandbox(moduleName);
        const moduleCode = moduleInstance.properties?.Source || moduleInstance.source || '';
        
        try {
            const wrappedCode = `
                (function(module, exports, require) {
                    ${moduleCode}
                    return module.exports;
                })(module, module.exports, require);
            `;
            
            const result = vm.runInContext(wrappedCode, sandbox);
            this.loadedModules.set(moduleName, result);
            console.log(`📦 [${this.gameId}] Loaded ModuleScript: ${moduleName}`);
            return result;
        } catch (error) {
            console.error(`❌ [${this.gameId}] ModuleScript error ${moduleName}:`, error);
            return null;
        }
    }
    
    createModuleSandbox(moduleName) {
        const resolver = this;
        
        const sandbox = vm.createContext({
            module: { exports: {} },
            exports: {},
            require: (name) => resolver.require(name),
            console: {
                log: (...args) => console.log(`[${this.gameId}][Module:${moduleName}]`, ...args),
                warn: (...args) => console.warn(`[${this.gameId}][Module:${moduleName}]`, ...args),
                error: (...args) => console.error(`[${this.gameId}][Module:${moduleName}]`, ...args)
            },
            setTimeout: setTimeout,
            setInterval: setInterval,
            clearTimeout: clearTimeout,
            clearInterval: clearInterval
        });
        
        return sandbox;
    }
}

// Create Roblox-like game API for ServerScripts
function createGameAPI(gameId, playerManager, moduleResolver) {
    return {
        gameId: gameId,
        
        GetService: function(serviceName) {
            const services = {
                ReplicatedStorage: {
                    WaitForChild: function(remoteName) {
                        const remote = getRemoteEvent(remoteName);
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
                            FireServer: function(player, ...args) {
                                console.log(`[${gameId}] 📡 FireServer from ${player?.name}: ${remoteName}`, args);
                                remote.serverListeners.forEach(listener => {
                                    try {
                                        if (listener.gameId === gameId) {
                                            listener.callback(player, ...args);
                                        }
                                    } catch (e) {
                                        console.error(`RemoteEvent error:`, e);
                                    }
                                });
                            },
                            OnServerEvent: function(callback) {
                                remote.serverListeners.push({ callback, gameId });
                                console.log(`[${gameId}] 📡 OnServerEvent registered: ${remoteName}`);
                            },
                            OnClientEvent: function(callback) {
                                remote.clientListeners.push({ callback, gameId });
                            }
                        };
                    }
                },
                Players: {
                    GetPlayers: function() {
                        return playerManager.getAllPlayers();
                    },
                    GetPlayerByUserId: function(userId) {
                        return playerManager.getPlayer(userId);
                    },
                    LocalPlayer: null,
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
                    },
                    FindFirstChild: function(name) {
                        for (const [id, part] of this.Parts) {
                            if (part.name === name) return part;
                        }
                        return null;
                    }
                },
                Chat: {
                    SendMessage: function(player, message) {
                        fireAllClients(gameId, 'ChatMessage', {
                            player: player?.displayName || player?.name || 'Server',
                            message: message
                        });
                    }
                },
                RunService: {
                    Heartbeat: {
                        Connect: function(callback) {
                            const interval = setInterval(() => {
                                callback(1/60);
                            }, 1000/60);
                            return { Disconnect: () => clearInterval(interval) };
                        }
                    },
                    Stepped: {
                        Connect: function(callback) {
                            const interval = setInterval(() => {
                                callback(1/60, Date.now() / 1000);
                            }, 1000/60);
                            return { Disconnect: () => clearInterval(interval) };
                        }
                    }
                },
                require: (moduleName) => moduleResolver.require(moduleName)
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
        },
        
        script: {
            Name: "ServerScript",
            Parent: { Name: "ServerScriptService" }
        }
    };
}

// Player manager for each game
class PlayerManager {
    constructor(gameId) {
        this.gameId = gameId;
        this.players = new Map();
        this.playerAddedCallbacks = [];
        this.playerRemovedCallbacks = [];
    }
    
    addPlayer(socket, playerId, username, displayName, userData = {}) {
        const player = {
            id: playerId,
            userId: playerId,
            name: username,
            displayName: displayName || username,
            socket: socket,
            data: new Map(Object.entries(userData)),
            joinedAt: Date.now()
        };
        
        this.players.set(playerId, player);
        
        this.playerAddedCallbacks.forEach(cb => {
            try {
                cb(player);
            } catch (e) {
                console.error(`PlayerAdded callback error:`, e);
            }
        });
        
        fireAllClients(this.gameId, 'PlayerJoined', {
            id: playerId,
            name: player.displayName,
            userId: player.userId
        });
        
        return player;
    }
    
    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            this.players.delete(playerId);
            this.playerRemovedCallbacks.forEach(cb => {
                try {
                    cb(player);
                } catch (e) {
                    console.error(`PlayerRemoved callback error:`, e);
                }
            });
            fireAllClients(this.gameId, 'PlayerLeft', playerId);
        }
    }
    
    getPlayer(playerId) {
        return this.players.get(playerId);
    }
    
    getPlayerByUserId(userId) {
        return this.players.get(userId);
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
function runServerScripts(gameId, scripts, playerManager, moduleResolver) {
    const gameAPI = createGameAPI(gameId, playerManager, moduleResolver);
    const results = [];
    
    for (const script of scripts) {
        try {
            const sandbox = vm.createContext({
                ...gameAPI,
                script: {
                    Name: script.name,
                    Parent: { Name: "ServerScriptService" }
                },
                console: {
                    log: (...args) => console.log(`[${gameId}][${script.name}]`, ...args),
                    warn: (...args) => console.warn(`[${gameId}][${script.name}]`, ...args),
                    error: (...args) => console.error(`[${gameId}][${script.name}]`, ...args)
                },
                setTimeout: setTimeout,
                setInterval: setInterval,
                clearTimeout: clearTimeout,
                clearInterval: clearInterval,
                require: (moduleName) => moduleResolver.require(moduleName)
            });
            
            const scriptCode = script.source || script.properties?.Source || '';
            
            const wrappedCode = `
                (function() {
                    ${scriptCode}
                    
                    if (typeof Init === 'function') Init();
                    if (typeof Start === 'function') Start();
                    if (typeof init === 'function') init();
                    if (typeof start === 'function') start();
                    
                    return {
                        onUpdate: typeof onUpdate === 'function' ? onUpdate : null,
                        onPlayerJoined: typeof onPlayerJoined === 'function' ? onPlayerJoined : null,
                        onPlayerLeft: typeof onPlayerLeft === 'function' ? onPlayerLeft : null,
                        onTick: typeof onTick === 'function' ? onTick : null
                    };
                })();
            `;
            
            const result = vm.runInContext(wrappedCode, sandbox);
            results.push({ script, result, sandbox });
            console.log(`✅ [${gameId}] Loaded ServerScript: ${script.name}`);
            
        } catch (error) {
            console.error(`❌ [${gameId}] Error in script ${script.name}:`, error);
            fireAllClients(gameId, 'ScriptError', {
                script: script.name,
                error: error.message
            });
        }
    }
    
    return results;
}

// Find all scripts in game data recursively
function findAllScripts(objects, scriptType = null, parentPath = '') {
    const scripts = [];
    
    for (const obj of objects) {
        if (obj.type === 'Script' || obj.type === 'LocalScript' || obj.type === 'ModuleScript') {
            if (scriptType === null || obj.type === scriptType) {
                const isServerScript = obj.parent === 'service_serverscriptservice' || 
                                      parentPath.includes('ServerScriptService') ||
                                      obj.type === 'Script';
                
                const isLocalScript = obj.type === 'LocalScript' ||
                                     parentPath.includes('StarterPlayer') ||
                                     parentPath.includes('StarterGui');
                
                scripts.push({
                    id: obj.id,
                    name: obj.name,
                    type: obj.type,
                    source: obj.properties?.Source || obj.source || '',
                    properties: obj.properties || {},
                    isServerScript: isServerScript,
                    isLocalScript: isLocalScript,
                    parentPath: parentPath
                });
            }
        }
        
        if (obj.children && obj.children.length > 0) {
            const childScripts = findAllScripts(obj.children, scriptType, `${parentPath}/${obj.name}`);
            scripts.push(...childScripts);
        }
    }
    
    return scripts;
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
        
        const allScripts = game.gameData?.objects ? findAllScripts(game.gameData.objects) : [];
        
        const serverScripts = allScripts.filter(s => s.type === 'Script' || s.isServerScript);
        const localScripts = allScripts.filter(s => s.type === 'LocalScript' || s.isLocalScript);
        const moduleScripts = allScripts.filter(s => s.type === 'ModuleScript');
        
        console.log(`📜 Found ${serverScripts.length} ServerScripts, ${localScripts.length} LocalScripts, ${moduleScripts.length} ModuleScripts`);
        
        const playerManager = new PlayerManager(gameId);
        const moduleResolver = new ModuleResolver(gameId, null);
        
        const scriptResults = runServerScripts(gameId, serverScripts, playerManager, moduleResolver);
        
        const gameServer = {
            id: gameId,
            name: game.name,
            gameData: game.gameData,
            playerManager: playerManager,
            scripts: scriptResults,
            localScripts: localScripts,
            moduleResolver: moduleResolver,
            startedAt: Date.now(),
            updateCallbacks: []
        };
        
        gameServers.set(gameId, gameServer);
        
        let lastUpdate = Date.now();
        const updateInterval = setInterval(() => {
            const now = Date.now();
            const dt = Math.min(0.033, (now - lastUpdate) / 1000);
            lastUpdate = now;
            
            for (const scriptResult of scriptResults) {
                if (scriptResult.result && scriptResult.result.onUpdate) {
                    try {
                        scriptResult.result.onUpdate(dt);
                    } catch (error) {
                        console.error(`Error in onUpdate for ${scriptResult.script.name}:`, error);
                    }
                }
                if (scriptResult.result && scriptResult.result.onTick) {
                    try {
                        scriptResult.result.onTick(dt);
                    } catch (error) {
                        console.error(`Error in onTick for ${scriptResult.script.name}:`, error);
                    }
                }
            }
            
            for (const callback of gameServer.updateCallbacks) {
                try {
                    callback(dt);
                } catch (e) {}
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

function getLocalScriptsForClient(gameId) {
    const gameServer = gameServers.get(gameId);
    if (!gameServer) return [];
    
    return gameServer.localScripts.map(script => ({
        id: script.id,
        name: script.name,
        source: script.source,
        type: script.type
    }));
}

// ==================== SOCKET.IO HANDLERS ====================
io.on('connection', (socket) => {
    console.log(`🔌 New connection: ${socket.id}`);
    
    let currentGameId = null;
    let currentPlayerId = null;
    
    socket.on('joinGame', async (data) => {
        const { gameId, playerId, username, displayName, sessionToken } = data;
        
        console.log(`🎮 Player ${displayName} (${username}) joining game ${gameId}`);
        
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
        
        const player = gameServer.playerManager.addPlayer(socket, currentPlayerId, username, displayName);
        
        socket.join(gameId);
        
        const localScripts = getLocalScriptsForClient(gameId);
        
        socket.emit('gameJoined', {
            gameId: gameId,
            gameName: gameServer.name,
            playerId: currentPlayerId,
            player: {
                id: player.id,
                name: player.displayName,
                userId: player.userId
            },
            players: gameServer.playerManager.getAllPlayers().map(p => ({
                id: p.id,
                name: p.displayName,
                userId: p.userId
            })),
            gameData: gameServer.gameData,
            localScripts: localScripts
        });
        
        socket.to(gameId).emit('playerJoined', {
            id: player.id,
            name: player.displayName
        });
        
        console.log(`✅ ${displayName} joined game ${gameId} (Total: ${gameServer.playerManager.getPlayerCount()})`);
    });
    
    socket.on('remote:fireServer', (data) => {
        const { name, args } = data;
        const remote = getRemoteEvent(name);
        
        if (remote && remote.serverListeners) {
            remote.serverListeners.forEach(listener => {
                if (listener.gameId === currentGameId) {
                    try {
                        const gameServer = gameServers.get(currentGameId);
                        const player = gameServer?.playerManager.getPlayer(currentPlayerId);
                        listener.callback(player, ...(args || []));
                    } catch (error) {
                        console.error(`Error in remote listener for ${name}:`, error);
                    }
                }
            });
        }
    });
    
    socket.on('playerUpdate', (data) => {
        if (currentGameId) {
            socket.to(currentGameId).emit('playerUpdate', {
                playerId: currentPlayerId,
                ...data
            });
        }
    });
    
    socket.on('chatMessage', (data) => {
        if (currentGameId) {
            const gameServer = gameServers.get(currentGameId);
            const player = gameServer?.playerManager.getPlayer(currentPlayerId);
            io.to(currentGameId).emit('chatMessage', {
                player: player?.displayName || 'Unknown',
                message: data.message,
                timestamp: Date.now()
            });
        }
    });
    
    socket.on('executeScript', (data) => {
        const { scriptId, code, instanceId } = data;
        console.log(`📜 Client requested script execution: ${scriptId}`);
    });
    
    socket.on('disconnect', () => {
        console.log(`🔌 Disconnected: ${socket.id}`);
        
        if (currentGameId && currentPlayerId) {
            const gameServer = gameServers.get(currentGameId);
            if (gameServer) {
                gameServer.playerManager.removePlayer(currentPlayerId);
                console.log(`👋 Player left game ${currentGameId}`);
            }
        }
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

// ==================== GAME API ENDPOINTS ====================
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Tavian Studio API with Socket.IO Game Server',
        activeGames: gameServers.size,
        activePlayers: Array.from(gameServers.values()).reduce((sum, g) => sum + g.playerManager.getPlayerCount(), 0),
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
            startedAt: game.startedAt,
            scriptsRunning: game.scripts.length
        });
    }
    res.json({ activeGames, totalPlayers: Array.from(gameServers.values()).reduce((sum, g) => sum + g.playerManager.getPlayerCount(), 0) });
});

app.get('/api/game-stats/:gameId', (req, res) => {
    const game = gameServers.get(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not active' });
    res.json({
        name: game.name,
        players: game.playerManager.getPlayerCount(),
        startedAt: game.startedAt,
        scriptsRunning: game.scripts.length,
        localScripts: game.localScripts.length
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
        activeServers: { games: gameServers.size, players: Array.from(gameServers.values()).reduce((sum, g) => sum + g.playerManager.getPlayerCount(), 0) }
    });
});

app.get('/download', (req, res) => {
    if (!fs.existsSync(INSTALLER_PATH)) return res.status(404).json({ error: 'Installer not found' });
    res.download(INSTALLER_PATH, 'TavianSetup.exe');
});

// ==================== FIX 3: Enhanced health check for Render ====================
app.get('/api/health', (req, res) => { 
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        storage: USE_TMP ? '/tmp' : 'local',
        uptime: process.uptime()
    }); 
});

// ==================== FIX 4: Handle Render's shutdown gracefully ====================
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    for (const [id, game] of gameServers) {
        if (game.updateInterval) clearInterval(game.updateInterval);
    }
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// ==================== START SERVER ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    🟣 Tavian Studio Game Server                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  📡 HTTP Server: http://0.0.0.0:${PORT}                                        ║
║  🔌 Socket.IO Server: ws://0.0.0.0:${PORT}                                     ║
║  💾 Storage Mode: ${USE_TMP ? 'Render /tmp (ephemeral)' : 'Local (persistent)'}    ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  🎮 SCRIPT TYPES SUPPORTED:                                                   ║
║  ✅ ServerScripts - Run on server, handle game logic                         ║
║  ✅ LocalScripts - Sent to client, handle UI and input                       ║
║  ✅ ModuleScripts - Shared code between scripts (require()!)                 ║
╚═══════════════════════════════════════════════════════════════════════════════╝
    `);
});
