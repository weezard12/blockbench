import {app, BrowserWindow, Menu, ipcMain, shell} from 'electron'
import path from 'path'
import url from 'url'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const { autoUpdater } = require('electron-updater');
const remote = require('@electron/remote/main')
remote.initialize();

let all_wins = [];
let orig_win;
let load_project_data;
const startup_log_only = process.argv.includes('--startup-log-only');

function serializeMainDetails(details, depth = 0, seen = new WeakSet()) {
	if (details === null || details === undefined) return details;
	if (typeof details === 'string' || typeof details === 'number' || typeof details === 'boolean') return details;
	if (details instanceof Error) {
		return {
			name: details.name,
			message: details.message,
			stack: details.stack,
		};
	}
	if (Array.isArray(details)) {
		return details.slice(0, 20).map(item => serializeMainDetails(item, depth + 1, seen));
	}
	if (typeof details === 'object') {
		if (depth > 2) return '[MaxDepth]';
		if (seen.has(details)) return '[Circular]';
		seen.add(details);
		let result = {};
		Object.keys(details).slice(0, 25).forEach(key => {
			try {
				result[key] = serializeMainDetails(details[key], depth + 1, seen);
			} catch (error) {
				result[key] = `[Unserializable: ${error?.message || error}]`;
			}
		});
		return result;
	}
	return String(details);
}
function logMain(message, details) {
	let suffix = '';
	if (details !== undefined) {
		try {
			suffix = ' ' + JSON.stringify(serializeMainDetails(details));
		} catch (error) {
			suffix = ' [unserializable details]';
		}
	}
	console.log(`[Blockbench main] ${message}${suffix}`);
}

process.on('uncaughtException', (error) => {
	console.error('[Blockbench main] uncaughtException', serializeMainDetails(error));
});
process.on('unhandledRejection', (reason) => {
	console.error('[Blockbench main] unhandledRejection', serializeMainDetails(reason));
});

(() => {
	// Allow advanced users to specify a custom userData directory.
	// Useful for portable installations, and for setting up development environments.
	const index = process.argv.findIndex(arg => arg === '--userData');
	if (index !== -1) {
		if (!process.argv.at(index + 1)) {
			console.error('No path specified after --userData')
			process.exit(1)
		}
		app.setPath('userData', process.argv[index + 1]);
	}
})()

const LaunchSettings = {
	path: path.join(app.getPath('userData'), 'launch_settings.json'),
	settings: {},
	get(key) {
		return this.settings[key]
	},
	set(key, value) {
		this.settings[key] = value;
		let content = JSON.stringify(this.settings, null, '\t');
		fs.writeFileSync(this.path, content);
	},
	load() {
		try {
			if (fs.existsSync(this.path)) {
				let content = fs.readFileSync(this.path, 'utf-8');
				this.settings = JSON.parse(content);
			}
		} catch (error) {}
		return this;
	}
}.load();

if (LaunchSettings.get('hardware_acceleration') == false) {
	app.disableHardwareAcceleration();
}

function createWindow(second_instance, options = {}) {
	logMain('createWindow called', {
		second_instance: !!second_instance,
		options,
		startup_log_only,
		argv_tail: process.argv.slice(-6),
	});
	if (app.requestSingleInstanceLock && !app.requestSingleInstanceLock()) {
		logMain('single instance lock request failed; quitting');
		app.quit()
		return;
	}
	let win_options = {
		icon: 'icon.ico',
		show: false,
		backgroundColor: '#21252b',
		frame: LaunchSettings.get('native_window_frame') === true,
		titleBarStyle: 'hidden',
		minWidth: 640,
		minHeight: 480,
		width: 1080,
		height: 720,
		webPreferences: {
			webgl: true,
			webSecurity: true,
			nodeIntegration: true,
			contextIsolation: false,
			enableRemoteModule: true
		}
	};
	if (options.position) {
		win_options.x = options.position[0] - 300;
		win_options.y = Math.max(options.position[1] - 100, 0);
	}
	let win = new BrowserWindow(win_options)
	logMain('BrowserWindow created', {
		id: win.id,
		show: win_options.show,
		frame: win_options.frame,
		titleBarStyle: win_options.titleBarStyle,
		bounds: {width: win_options.width, height: win_options.height, x: win_options.x, y: win_options.y},
		webPreferences: win_options.webPreferences,
	});
	if (!orig_win) orig_win = win;
	all_wins.push(win);

	remote.enable(win.webContents)
	logMain('remote module enabled for window', {id: win.id});
	win.on('close', () => {
		logMain('window close requested', {id: win.id});
	});
	win.on('ready-to-show', () => {
		logMain('window ready-to-show', {id: win.id});
	});
	win.on('unresponsive', () => {
		logMain('window became unresponsive', {id: win.id});
	});
	win.on('responsive', () => {
		logMain('window responsive again', {id: win.id});
	});
	win.webContents.on('did-start-loading', () => {
		logMain('webContents did-start-loading', {id: win.id, url: win.webContents.getURL()});
	});
	win.webContents.on('dom-ready', () => {
		logMain('webContents dom-ready', {id: win.id, url: win.webContents.getURL()});
	});
	win.webContents.on('did-frame-finish-load', (event, isMainFrame, frameProcessId, frameRoutingId) => {
		logMain('webContents did-frame-finish-load', {
			id: win.id,
			isMainFrame,
			frameProcessId,
			frameRoutingId,
			url: win.webContents.getURL(),
		});
	});
	win.webContents.on('did-finish-load', () => {
		logMain('webContents did-finish-load', {id: win.id, url: win.webContents.getURL()});
	});
	win.webContents.on('did-stop-loading', () => {
		logMain('webContents did-stop-loading', {id: win.id, url: win.webContents.getURL()});
	});
	win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame, frameProcessId, frameRoutingId) => {
		console.error('[Blockbench main] webContents did-fail-load', serializeMainDetails({
			id: win.id,
			errorCode,
			errorDescription,
			validatedURL,
			isMainFrame,
			frameProcessId,
			frameRoutingId,
		}));
	});
	win.webContents.on('did-fail-provisional-load', (event, errorCode, errorDescription, validatedURL, isMainFrame, frameProcessId, frameRoutingId) => {
		console.error('[Blockbench main] webContents did-fail-provisional-load', serializeMainDetails({
			id: win.id,
			errorCode,
			errorDescription,
			validatedURL,
			isMainFrame,
			frameProcessId,
			frameRoutingId,
		}));
	});
	win.webContents.on('render-process-gone', (event, details) => {
		console.error('[Blockbench main] webContents render-process-gone', serializeMainDetails({
			id: win.id,
			details,
			url: win.webContents.getURL(),
		}));
	});
	win.webContents.on('preload-error', (event, preloadPath, error) => {
		console.error('[Blockbench main] webContents preload-error', serializeMainDetails({
			id: win.id,
			preloadPath,
			error,
		}));
	});
	win.webContents.on('destroyed', () => {
		logMain('webContents destroyed', {id: win.id});
	});
	win.webContents.on('console-message', (event, level, message, line, sourceId) => {
		if (sourceId?.startsWith('devtools://')) return;
		if (sourceId?.startsWith('chrome-devtools://')) return;
		const logger = level >= 2 ? console.error : level === 1 ? console.warn : console.log;
		logger(`[Blockbench renderer console] ${message}`, serializeMainDetails({
			id: win.id,
			level,
			line,
			sourceId,
		}));
	});

	if (process.platform === 'darwin') {

		let template = [
			{
				"label": "Blockbench",
				"submenu": [
					{
						"role": "hide"
					},
					{
						"role": "hideothers"
					},
					{
						"role": "unhide"
					},
					{
						"type": "separator"
					},
					{
                        "role": "quit"
					}
				]
			},
			{
				"label": "Edit",
				"submenu": [
					{
						"role": "cut"
					},
					{
						"role": "copy"
					},
					{
						"role": "paste"
					},
					{
						"role": "selectall"
					}
				]
			},
			{
				"label": "Window",
				"role": "window",
				"submenu": [
					{
						"label": "Toggle Full Screen",
						"accelerator": "Ctrl+Command+F"
					},
					{
						"role": "minimize"
					},
					{
						"role": "close"
					},
					{
						"type": "separator"
					},
					{
						"role": "front"
					}
				]
			}
		]


		var osxMenu = Menu.buildFromTemplate(template);
		Menu.setApplicationMenu(osxMenu)
	} else {
		win.setMenu(null);
	}
	
	if (startup_log_only) {
		logMain('startup-log-only mode enabled; window will remain hidden', {id: win.id});
	} else {
		if (options.maximize !== false) win.maximize()
		win.show()
		logMain('window shown', {id: win.id, maximized: options.maximize !== false});
	}

	var index_path = path.join(__dirname, './../index.html')
	logMain('loading index.html into window', {id: win.id, index_path});
	win.loadURL(url.format({
		pathname: index_path,
		protocol: 'file:',
		slashes: true
	}))
	win.on('closed', () => {
		logMain('window closed', {id: win.id});
		win = null;
		all_wins.splice(all_wins.indexOf(win), 1);
	})
	if (second_instance === true) {
		win.webContents.second_instance = true;
		logMain('window marked as second-instance window', {id: win.id});
	}
	return win;
}

app.commandLine.appendSwitch('ignore-gpu-blacklist')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-accelerated-video')
logMain('command line switches configured', {
	startup_log_only,
	switches: ['ignore-gpu-blacklist', 'ignore-gpu-blocklist', 'enable-accelerated-video'],
});

app.on('second-instance', function (event, argv, cwd) {
	logMain('app second-instance event', {argv_tail: argv.slice(-6), cwd});
	process.argv = argv;
	let win = all_wins.find(win => !win.isDestroyed());
	if (win && argv[argv.length-1 || 1] && argv[argv.length-1 || 1].substr(0, 2) !== '--') {
		win.webContents.send('open-model', argv[argv.length-1 || 1]);
		win.focus();
	} else {
		createWindow(true);
	}
})
app.on('open-file', function (event, path) {
	logMain('app open-file event', {path});
	process.argv[process.argv.length-1 || 1] = path;
	let win = all_wins.find(win => !win.isDestroyed());
	if (win) {
		win.webContents.send('open-model', path);
	}
})

ipcMain.on('edit-launch-setting', (event, arg) => {
	LaunchSettings.set(arg.key, arg.value);
})
ipcMain.handle('get-launch-setting', (event, arg) => {
	return LaunchSettings.get(arg.key);
})
ipcMain.on('add-recent-project', (event, path) => {
	app.addRecentDocument(path);
})
ipcMain.on('dragging-tab', (event, value) => {
	all_wins.forEach(win => {
		if (win.isDestroyed() || win.id == event.sender.id) return;
		win.webContents.send('accept-detached-tab', JSON.parse(value));
	})
})
ipcMain.on('new-window', (event, data, position) => {
	if (typeof data == 'string') load_project_data = JSON.parse(data);
	if (position) {
		position = JSON.parse(position)
		let place_in_window = all_wins.find(win => {
			if (win.isDestroyed() || win.webContents == event.sender || win.isMinimized()) return false;
			let pos = win.getPosition();
			let size = win.getSize();
			return (position.offset[0] >= pos[0] && position.offset[0] <= pos[0] + size[0]
				 && position.offset[1] >= pos[1] && position.offset[1] <= pos[1] + size[1]);
		})
		if (place_in_window) {
			place_in_window.send('load-tab', load_project_data);
			place_in_window.focus();
			load_project_data = null;
		} else {
			createWindow(true, {
				maximize: false,
				position: position.offset
			});
		}
	} else {
		createWindow(true);
	}
})
ipcMain.on('close-detached-project', async (event, window_id, uuid) => {
	let window = all_wins.find(win => win.id == window_id);
	if (window) window.send('close-detached-project', uuid);
})
ipcMain.on('request-color-picker', async (event, arg) => {
	const ColorPicker = await import('electron-color-picker');
	const color = await ColorPicker.getColorHexRGB().catch((error) => {
		console.warn('[Error] Failed to pick color', error)
		return ''
	})
	if (color) {
		all_wins.forEach(win => {
			if (win.isDestroyed() || (!arg.sync && win.webContents.getProcessId() != event.sender.getProcessId())) return;
			win.webContents.send('set-main-color', color)
		})
	}
})
ipcMain.on('show-item-in-folder', async (event, path) => {
	shell.showItemInFolder(path);
})
ipcMain.on('open-in-default-app', async (event, path) => {
	shell.openPath(path);
})
function logRendererPayload(prefix, payload = {}) {
	if (!payload || typeof payload.message != 'string') return;
	let details_text = '';
	if (payload.details !== undefined) {
		try {
			details_text = ' ' + JSON.stringify(payload.details);
		} catch (error) {
			details_text = ' [unserializable details]';
		}
	}
	const level = payload.level === 'error'
		? 'error'
		: payload.level === 'warn'
			? 'warn'
			: 'log';
	const logger = console[level].bind(console);
	logger(`[${prefix}] ${payload.message}${details_text}`);
}
ipcMain.on('plugin-init-log', (event, payload = {}) => {
	logRendererPayload('Blockbench plugin-init', payload);
})
ipcMain.on('renderer-startup-log', (event, payload = {}) => {
	logRendererPayload('Blockbench startup', payload);
})

app.on('child-process-gone', (event, details) => {
	console.error('[Blockbench main] child-process-gone', serializeMainDetails(details));
})
app.on('gpu-info-update', () => {
	logMain('gpu-info-update fired');
})
app.on('before-quit', (event) => {
	logMain('before-quit fired', {window_count: all_wins.length});
})
app.on('will-quit', (event) => {
	logMain('will-quit fired', {window_count: all_wins.length});
})
app.on('quit', (event, exitCode) => {
	logMain('quit fired', {exitCode});
})
app.on('ready', () => {
	logMain('app ready', {
		execPath: process.execPath,
		appPath: app.getAppPath(),
		userData: app.getPath('userData'),
		argv_tail: process.argv.slice(-8),
	});
	const dev_mode = process.execPath && process.execPath.match(/node_modules[\\\/]electron/);
	logMain('ready handler entered', {dev_mode: !!dev_mode, startup_log_only});

	if (dev_mode) {

		// Timeout to avoid race condition of Blockbench opening before esbuild finishes. Needs proper solution long-term
		setTimeout(() => {
			logMain('creating development window after startup delay');
			createWindow()
		}, 1000);

	} else {

		logMain('creating production window immediately');
		createWindow()
		
	}

	let app_was_loaded = false;
	ipcMain.on('app-loaded', () => {
		logMain('app-loaded IPC received', {
			app_was_loaded,
			has_pending_project_data: !!load_project_data,
			window_count: all_wins.length,
		});
		if (load_project_data) {
			all_wins[all_wins.length-1].send('load-tab', load_project_data);
			load_project_data = null;
		}

		if (app_was_loaded) {
			console.log('[Blockbench] App reloaded or new window opened')
			return;
		}

		app_was_loaded = true;
		if (dev_mode) {

			console.log('[Blockbench] App launched in development mode')
	
		} else {
	
			autoUpdater.autoInstallOnAppQuit = true;
			autoUpdater.autoDownload = false;
			if (LaunchSettings.get('update_to_prereleases') === true) {
				autoUpdater.allowPrerelease = true;
				//autoUpdater.channel = 'beta';
			}
	
			autoUpdater.on('update-available', (a) => {
				console.log('update-available', a)
				ipcMain.on('allow-auto-update', () => {
					autoUpdater.downloadUpdate()
				})
				if (!orig_win.isDestroyed()) orig_win.webContents.send('update-available', a);
			})
			autoUpdater.on('update-downloaded', (a) => {
				console.log('update-downloaded', a)
				if (!orig_win.isDestroyed()) orig_win.webContents.send('update-downloaded', a)
			})
			autoUpdater.on('error', (a) => {
				console.log('update-error', a)
				if (!orig_win.isDestroyed()) orig_win.webContents.send('update-error', a)
			})
			autoUpdater.on('download-progress', (a) => {
				console.log('update-progress', a)
				if (!orig_win.isDestroyed()) orig_win.webContents.send('update-progress', a)
			})
			autoUpdater.checkForUpdates().catch(err => {})
		}
	})
})

app.on('window-all-closed', () => {
	logMain('window-all-closed fired; quitting app');
	app.quit()
})
