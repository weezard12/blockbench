import { Blockbench } from "./api";
import { updateStreamerModeNotification } from "./interface/setup_settings";
import { loadThemes } from "./interface/themes";
import { translateUI } from "./languages";
import { loadInstalledPlugins } from "./plugin_loader";
import { animate } from "./preview/preview";
import { emitStartupLog, ipcRenderer, SystemInfo } from "./native_apis";
import { initializeDesktopApp, loadOpenWithBlockbenchFile } from "./desktop";
import { AutoBackup } from "./auto_backup";
import { initReferenceImages } from "./preview/reference_images";

function serializeStartupError(error) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		}
	}
	return error;
}
function startupLog(message, details) {
	emitStartupLog(message, 'log', details);
}
function startupError(message, error) {
	emitStartupLog(message, 'error', serializeStartupError(error));
}

startupLog('boot_loader: module evaluation started');

Interface.page_wrapper = document.getElementById('page_wrapper');
Interface.work_screen = document.getElementById('work_screen');
Interface.center_screen = document.getElementById('center');
Interface.right_bar = document.getElementById('right_bar');
Interface.left_bar = document.getElementById('left_bar');
Interface.preview = document.getElementById('preview');
startupLog('boot_loader: interface nodes bound');

CustomTheme.setup();
startupLog('boot_loader: custom theme setup complete');

StateMemory.init('dialog_paths', 'object')
startupLog('boot_loader: StateMemory initialized');

initCanvas()
animate()
startupLog('boot_loader: canvas initialized and animation loop started');

Blockbench.browser = 'electron'
if (isApp === false) {
	if (navigator.userAgent.toLowerCase().indexOf('firefox') > -1) {
		Blockbench.browser = 'firefox'
	} else if (!!window.chrome && !!window.chrome.webstore) {
		Blockbench.browser = 'chrome'
	} else if ((!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0) {
		Blockbench.browser = 'opera'
	} else if (/constructor/i.test(window.HTMLElement) || (function (p) { return p.toString() === "[object SafariRemoteNotification]"; })(!window['safari'] || (typeof safari !== 'undefined' && safari.pushNotification))) {
		Blockbench.browser = 'safari'
	} else if (!!document.documentMode) {
		Blockbench.browser = 'internet_explorer'
	} else if (!!window.chrome && window.navigator.userAgent.toLowerCase().includes('edg')) {
		Blockbench.browser = 'edge'
	} else if (!!window.StyleMedia) {
		Blockbench.browser = 'proprietary_edge'
	} else if (!!window.chrome && !window.chrome.webstore) {
		Blockbench.browser = 'chromium'
	}
	if (navigator.appVersion.indexOf("Win") != -1) 	 Blockbench.operating_system = 'Windows';
	if (navigator.appVersion.indexOf("Mac") != -1) 	 Blockbench.operating_system = 'MacOS';
	if (navigator.appVersion.indexOf("Linux") != -1) Blockbench.operating_system = 'Linux';
	if (['proprietary_edge', 'internet_explorer'].includes(Blockbench.browser)) {
		alert(capitalizeFirstLetter(Blockbench.browser)+' does not support Blockbench')
	}
	$('.local_only').remove()
} else {
	$('.web_only').remove()
}
startupLog('boot_loader: runtime environment detected', {
	isApp,
	browser: Blockbench.browser,
	operating_system: Blockbench.operating_system,
});
BARS.setupActions()
BARS.setupActions && startupLog('boot_loader: BARS.setupActions finished');
BARS.setupToolbars()
BARS.setupToolbars && startupLog('boot_loader: BARS.setupToolbars finished');
BARS.setupVue()
BARS.setupVue && startupLog('boot_loader: BARS.setupVue finished');
MenuBar.setup()
startupLog('boot_loader: MenuBar.setup finished');
translateUI()
startupLog('boot_loader: translateUI finished');
loadThemes()
startupLog('boot_loader: loadThemes finished');
initReferenceImages()
startupLog('boot_loader: toolbars, menus, translations, themes, and reference images initialized');

console.log(`Three.js r${THREE.REVISION}`)
console.log('%cBlockbench ' + Blockbench.version + (isApp
	? (' Desktop (' + Blockbench.operating_system + ', ' + SystemInfo.arch +')')
	: (' Web ('+capitalizeFirstLetter(Blockbench.browser) + (Blockbench.isPWA ? ', PWA)' : ')'))),
	'border: 2px solid #3e90ff; padding: 4px 8px; font-size: 1.2em;'
)
Blockbench.startup_count = parseInt(localStorage.getItem('startups')||0) + 1;
localStorage.setItem('startups', Blockbench.startup_count);
startupLog('boot_loader: startup counter incremented', {startup_count: Blockbench.startup_count});

document.getElementById('blackout').addEventListener('click', event => {
	if (typeof open_interface.cancel == 'function' && open_interface.cancel_on_click_outside !== false) {
		open_interface.cancel(event);
	} else if (typeof open_interface == 'string' && open_dialog) {
		$('dialog#'+open_dialog).find('.cancel_btn:not([disabled])').trigger('click');
	}
})

if (isApp) {
	updateRecentProjects()
	startupLog('boot_loader: recent projects updated');
}

if (!isApp) {
	async function registerSW() {
		if ('serviceWorker' in navigator) {
			try {
				await navigator.serviceWorker.register('./service_worker.js');
			} catch (err) {
				console.log(err)
			}
		}
	}
	registerSW();
}

if (!Blockbench.isWeb || !Blockbench.isPWA) {
	$.ajaxSetup({ cache: false });
}

if (Blockbench.startup_count == 1) {
	try {
		jQuery.ajax({
			url: 'https://blckbn.ch/api/event/new_installation',
			type: 'POST',
			data: {}
		})
	} catch (err) {
		console.error(err);
	}
}
if (Blockbench.startup_count == 3) {
	try {
		jQuery.ajax({
			url: 'https://blckbn.ch/api/event/recurring_user',
			type: 'POST',
			data: {}
		})
	} catch (err) {
		console.error(err);
	}
}

Blockbench.on('before_closing', (event) => {
	if (!Blockbench.hasFlag('no_localstorage_saving')) {
		Settings.saveLocalStorages()
	}
})

updateProjectResolution()
startupLog('boot_loader: project resolution updated');

setupInterface()
setupDragHandlers()
startupLog('boot_loader: interface setup and drag handlers initialized');

startupLog('boot_loader: running onVueSetup hooks', {hook_count: onVueSetup.funcs.length});
onVueSetup.funcs.forEach((func) => {
	if (typeof func === 'function') {
		func()
	}
})
startupLog('boot_loader: onVueSetup hooks finished');

if (settings.streamer_mode.value) {
	updateStreamerModeNotification();
	startupLog('boot_loader: streamer mode notification updated');
}

AutoBackup.initialize();
startupLog('boot_loader: auto backup initialized');

if (isApp) {
	initializeDesktopApp();
	startupLog('boot_loader: desktop app initialization finished');
} else {
	initializeWebApp();
	startupLog('boot_loader: web app initialization finished');
}

localStorage.setItem('last_version', Blockbench.version);
startupLog('boot_loader: last_version persisted');

(function() {
	// Promise.any workaround
	let proceeded = false;
	function proceed(source = 'unknown') {
		if (proceeded) return;
		startupLog(`boot_loader: proceed entered via ${source}`);

		Settings.saveLocalStorages();
		startupLog('boot_loader: local storages saved during proceed');
		if (isApp) {
			startupLog('boot_loader: loading open-with file handlers');
			loadOpenWithBlockbenchFile();
			startupLog('boot_loader: sending app-loaded IPC');
			ipcRenderer.send('app-loaded');
		} else {
			startupLog('boot_loader: loading info from URL');
			loadInfoFromURL();
		}
		proceeded = true;
	}
	startupLog('boot_loader: starting installed plugin load');
	loadInstalledPlugins().then(() => {
		startupLog('boot_loader: loadInstalledPlugins resolved');
		proceed('plugins');
	}).catch(error => {
		startupError('boot_loader: loadInstalledPlugins rejected', error);
		throw error;
	});
	setTimeout(() => {
		startupLog('boot_loader: plugin load timeout fallback fired');
		proceed('timeout');
	}, 1200);
})()

setStartScreen(true);
startupLog('boot_loader: start screen initialized');

if (Blockbench.isMobile) {
	// Reselect tool to update transform toolbar in status bar on mobile
	Toolbox.selected = null;
	BarItems.move_tool.select();
	startupLog('boot_loader: mobile tool reselection finished');
}

document.getElementById('page_wrapper').classList.remove('invisible');
startupLog('boot_loader: page wrapper made visible');

Blockbench.setup_successful = true;
startupLog('boot_loader: setup_successful set true');
