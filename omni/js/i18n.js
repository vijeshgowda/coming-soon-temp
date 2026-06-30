/**
 * Omni — Internationalization (i18n)
 *
 * Tiny dependency-free translation layer. All user-facing strings live here,
 * keyed by a dotted name. The UI markup carries `data-i18n*` attributes that
 * `applyTranslations()` fills in; dynamic strings in app.js call `t(key, params)`.
 *
 * Node-safe: guards `localStorage` / `navigator` / `document` so the module can
 * be imported in the test runner.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'hi', label: 'हिन्दी' },
];

const STORAGE_KEY = 'omni-lang';
const SUPPORTED = LANGUAGES.map(l => l.code);

const translations = {
  // ─── English (source of truth) ───────────────────────────────────────────
  en: {
    'home.tagline_sub': 'Encrypted peer-to-peer',
    'home.h1a': 'Private calls.',
    'home.h1b': 'No middleman.',
    'home.hero_sub': 'Your audio, video, and files travel directly between browsers — fully encrypted, server-blind, leaving no trace.',
    'home.create': 'Create Room',
    'home.use_custom': 'Use a custom code',
    'home.custom_hint': '4-10 characters · letters & numbers · your friends will use this to join',
    'home.divider': 'or join with a code',
    'home.join': 'Join',
    'home.password_placeholder': 'Room password (optional)',
    'home.password_hint': 'Both people must enter the same password · strengthens the encryption key',
    'home.badge_zero': 'Zero server data',
    'home.connecting': 'Connecting to server…',
    'home.connecting_cold': 'Server cold start may take ~30s on first connect…',
    'home.connecting_join': 'Joining room…',
    'home.lang_label': 'Language',
    'home.theme_label': 'Toggle theme',

    'lobby.share_code': 'Share this code with your peer',
    'lobby.copy': 'Copy Code',
    'lobby.copied': 'Copied!',
    'lobby.code_changes_1': 'If the code changes after sharing,',
    'lobby.code_changes_2': 'use your copied code to join the room',
    'lobby.share_link': 'Share link',
    'lobby.share_title': 'Join my Omni call',
    'lobby.share_text': 'Join my encrypted call',
    'lobby.link_copied': 'Link copied!',
    'lobby.scan': 'Scan to join on another device',
    'lobby.waiting': 'Waiting for peer to join…',
    'lobby.cancel': 'Cancel',
    'lobby.new_room': 'New room created. Share the updated code…',
    'lobby.custom_ready': 'Your custom code is ready. Share it with your peer…',
    'lobby.reconnected': 'Reconnected. Still waiting for peer…',
    'lobby.session_expired': 'Session expired. Creating new room…',
    'lobby.reconnecting': 'Connection lost. Reconnecting… (attempt {attempt}/{max})',
    'lobby.peer_found': 'Peer found. Establishing encrypted connection…',

    'call.waiting_video': 'Waiting for video…',
    'call.muted': 'You’re muted',
    'call.drop': 'Drop files to send',

    'ctrl.mute': 'Mute',
    'ctrl.camera': 'Camera',
    'ctrl.screen': 'Screen',
    'ctrl.stop': 'Stop',
    'ctrl.flip': 'Flip',
    'ctrl.pip': 'PiP',
    'ctrl.record': 'Record',
    'ctrl.end': 'End',
    'ctrl.file': 'File',
    'ctrl.more': 'More',
    'ctrl.more_title': 'More options',
    'ctrl.mute_title': 'Toggle microphone',
    'ctrl.camera_title': 'Toggle camera',
    'ctrl.screen_title': 'Share screen',
    'ctrl.flip_title': 'Flip camera',
    'ctrl.pip_title': 'Picture in Picture',
    'ctrl.record_title': 'Record call (saved locally)',
    'ctrl.end_title': 'End call',
    'ctrl.file_title': 'Send files',
    'ctrl.send_label': 'Send message',

    'badge.quality_title': 'Connection quality',
    'badge.enc_title': 'Encryption status',

    'chat.title': 'Chat',
    'chat.clear': 'Clear',
    'chat.clear_title': 'Clear chat',
    'chat.establishing': 'Connection establishing… chat will be available once encrypted channel is ready.',
    'chat.typing': 'Peer is typing',
    'chat.placeholder': 'Type a message… (Enter to send)',
    'chat.you': 'You',
    'chat.peer': 'Peer',

    'sas.title': 'Verify your peer',
    'sas.hint': 'Compare these out loud. If they match, no one is intercepting.',
    'sas.match': 'They match',
    'sas.nomatch': 'Don’t match',

    'conn.connected': 'Connected',
    'conn.reconnecting': 'Reconnecting…',
    'conn.connecting': 'Connecting…',
    'conn.disconnected': 'Disconnected',
    'conn.failed': 'Failed',
    'conn.new': 'Setting up…',

    'sys.peer_disconnected': 'Peer disconnected.',
    'sys.audio_only': '⚠️ No camera available — joining with audio only.',
    'sys.channel_ready': '🔒 Encrypted channel established.',
    'sys.network_changed': '⟳ Network changed — reconnecting…',
    'sys.rx_streaming': '📎 Receiving “{name}” ({size}) — streaming to disk…',
    'sys.save_cancelled': '⚠️ Save cancelled — receiving into memory instead.',
    'sys.rx_large_warn': '⚠️ File is {size}. Use Chrome or Edge for large files to avoid running out of memory.',
    'sys.rx_receiving': '📎 Receiving “{name}” ({size})…',
    'sys.integrity_fail_saved': '❌ Integrity check FAILED for “{name}”. File saved but may be corrupted.',
    'sys.saved_verified': '✓ “{name}” saved to disk. SHA-256 verified.',
    'sys.integrity_fail': '❌ Integrity check FAILED for “{name}”. File may be corrupted.',
    'sys.wrong_password': '❌ Wrong room password — could not establish a private channel. Ending call.',
    'sys.send_failed_notready': '⚠️ Send failed — channel not ready yet.',
    'sys.screen_unsupported': '⚠️ Screen sharing is not supported on this device.',
    'sys.record_unsupported': '⚠️ Recording is not supported on this browser.',
    'sys.record_started': '🔴 Recording started (saved locally only).',
    'sys.record_error': '⚠️ Could not start recording: {error}',
    'sys.record_nodata': '⚠️ Recording produced no data.',
    'sys.record_saved': '💾 Recording saved ({size}).',
    'sys.chat_cleared': 'Chat cleared. Messages are never stored — they vanish when you leave.',
    'sys.sending': '📤 Sending “{name}” ({size})…',
    'sys.sent': '✓ Sent “{name}”.',
    'sys.send_failed': '❌ Send failed: {error}',
    'sys.sas_mismatch': '⚠️ Safety numbers did not match — ending call as a precaution.',
    'sys.pip_unsupported': '⚠️ Picture-in-Picture is not supported on this device.',
    'sys.pip_error': '⚠️ Could not enter Picture-in-Picture. Tap the PiP button during the call.',

    'err.reconnect_failed': 'Could not reconnect to signaling server. Please try again.',
    'err.permissions': 'Camera/mic access denied. Please allow permissions and try again.',
    'err.connect_failed': 'Failed to establish connection. Please try again.',
    'err.custom_length': 'Custom codes must be between 4 and 10 characters.',
    'err.no_server': 'Could not connect to signaling server. Is it deployed?',
    'err.invalid_code': 'Enter a valid code (4–10 characters).',

    'file.sending': 'Sending {name}: {pct}%',
    'file.receiving': 'Receiving {name}: {pct}%',

    'a11y.lang_changed': 'Language changed to {lang}',
  },

  // ─── Spanish ──────────────────────────────────────────────────────────────
  es: {
    'home.tagline_sub': 'Cifrado de igual a igual',
    'home.h1a': 'Llamadas privadas.',
    'home.h1b': 'Sin intermediarios.',
    'home.hero_sub': 'Tu audio, vídeo y archivos viajan directamente entre navegadores — totalmente cifrados, invisibles para el servidor y sin dejar rastro.',
    'home.create': 'Crear sala',
    'home.use_custom': 'Usar un código personalizado',
    'home.custom_hint': '4-10 caracteres · letras y números · tus amigos lo usarán para unirse',
    'home.divider': 'o únete con un código',
    'home.join': 'Unirse',
    'home.password_placeholder': 'Contraseña de la sala (opcional)',
    'home.password_hint': 'Ambos deben introducir la misma contraseña · refuerza la clave de cifrado',
    'home.badge_zero': 'Cero datos en el servidor',
    'home.connecting': 'Conectando al servidor…',
    'home.connecting_cold': 'El servidor puede tardar ~30 s en el primer arranque…',
    'home.connecting_join': 'Uniéndose a la sala…',
    'home.lang_label': 'Idioma',
    'home.theme_label': 'Cambiar tema',

    'lobby.share_code': 'Comparte este código con tu interlocutor',
    'lobby.copy': 'Copiar código',
    'lobby.copied': '¡Copiado!',
    'lobby.code_changes_1': 'Si el código cambia tras compartirlo,',
    'lobby.code_changes_2': 'usa el código que copiaste para entrar a la sala',
    'lobby.share_link': 'Compartir enlace',
    'lobby.share_title': 'Únete a mi llamada de Omni',
    'lobby.share_text': 'Únete a mi llamada cifrada',
    'lobby.link_copied': '¡Enlace copiado!',
    'lobby.scan': 'Escanea para unirte desde otro dispositivo',
    'lobby.waiting': 'Esperando a que se una tu interlocutor…',
    'lobby.cancel': 'Cancelar',
    'lobby.new_room': 'Nueva sala creada. Comparte el código actualizado…',
    'lobby.custom_ready': 'Tu código personalizado está listo. Compártelo con tu interlocutor…',
    'lobby.reconnected': 'Reconectado. Aún esperando al interlocutor…',
    'lobby.session_expired': 'Sesión caducada. Creando una nueva sala…',
    'lobby.reconnecting': 'Conexión perdida. Reconectando… (intento {attempt}/{max})',
    'lobby.peer_found': 'Interlocutor encontrado. Estableciendo conexión cifrada…',

    'call.waiting_video': 'Esperando vídeo…',
    'call.muted': 'Tienes el micrófono silenciado',
    'call.drop': 'Suelta archivos para enviarlos',

    'ctrl.mute': 'Silenciar',
    'ctrl.camera': 'Cámara',
    'ctrl.screen': 'Pantalla',
    'ctrl.stop': 'Detener',
    'ctrl.flip': 'Girar',
    'ctrl.pip': 'PiP',
    'ctrl.record': 'Grabar',
    'ctrl.end': 'Colgar',
    'ctrl.file': 'Archivo',
    'ctrl.more': 'Más',
    'ctrl.more_title': 'Más opciones',
    'ctrl.mute_title': 'Activar/desactivar micrófono',
    'ctrl.camera_title': 'Activar/desactivar cámara',
    'ctrl.screen_title': 'Compartir pantalla',
    'ctrl.flip_title': 'Girar cámara',
    'ctrl.pip_title': 'Imagen en imagen',
    'ctrl.record_title': 'Grabar llamada (se guarda localmente)',
    'ctrl.end_title': 'Finalizar llamada',
    'ctrl.file_title': 'Enviar archivos',
    'ctrl.send_label': 'Enviar mensaje',

    'badge.quality_title': 'Calidad de la conexión',
    'badge.enc_title': 'Estado del cifrado',

    'chat.title': 'Chat',
    'chat.clear': 'Borrar',
    'chat.clear_title': 'Borrar el chat',
    'chat.establishing': 'Estableciendo la conexión… el chat estará disponible cuando el canal cifrado esté listo.',
    'chat.typing': 'El interlocutor está escribiendo',
    'chat.placeholder': 'Escribe un mensaje… (Enter para enviar)',
    'chat.you': 'Tú',
    'chat.peer': 'Interlocutor',

    'sas.title': 'Verifica a tu interlocutor',
    'sas.hint': 'Compáralos en voz alta. Si coinciden, nadie está interceptando.',
    'sas.match': 'Coinciden',
    'sas.nomatch': 'No coinciden',

    'conn.connected': 'Conectado',
    'conn.reconnecting': 'Reconectando…',
    'conn.connecting': 'Conectando…',
    'conn.disconnected': 'Desconectado',
    'conn.failed': 'Fallido',
    'conn.new': 'Preparando…',

    'sys.peer_disconnected': 'El interlocutor se desconectó.',
    'sys.audio_only': '⚠️ No hay cámara disponible — uniéndose solo con audio.',
    'sys.channel_ready': '🔒 Canal cifrado establecido.',
    'sys.network_changed': '⟳ La red cambió — reconectando…',
    'sys.rx_streaming': '📎 Recibiendo “{name}” ({size}) — guardando en disco…',
    'sys.save_cancelled': '⚠️ Guardado cancelado — recibiendo en memoria.',
    'sys.rx_large_warn': '⚠️ El archivo pesa {size}. Usa Chrome o Edge para archivos grandes y evitar quedarte sin memoria.',
    'sys.rx_receiving': '📎 Recibiendo “{name}” ({size})…',
    'sys.integrity_fail_saved': '❌ Falló la comprobación de integridad de “{name}”. Se guardó pero puede estar dañado.',
    'sys.saved_verified': '✓ “{name}” guardado en disco. SHA-256 verificado.',
    'sys.integrity_fail': '❌ Falló la comprobación de integridad de “{name}”. El archivo puede estar dañado.',
    'sys.wrong_password': '❌ Contraseña de sala incorrecta — no se pudo establecer un canal privado. Finalizando la llamada.',
    'sys.send_failed_notready': '⚠️ Fallo al enviar — el canal aún no está listo.',
    'sys.screen_unsupported': '⚠️ Compartir pantalla no es compatible con este dispositivo.',
    'sys.record_unsupported': '⚠️ La grabación no es compatible con este navegador.',
    'sys.record_started': '🔴 Grabación iniciada (se guarda solo localmente).',
    'sys.record_error': '⚠️ No se pudo iniciar la grabación: {error}',
    'sys.record_nodata': '⚠️ La grabación no produjo datos.',
    'sys.record_saved': '💾 Grabación guardada ({size}).',
    'sys.chat_cleared': 'Chat borrado. Los mensajes nunca se almacenan — desaparecen al salir.',
    'sys.sending': '📤 Enviando “{name}” ({size})…',
    'sys.sent': '✓ “{name}” enviado.',
    'sys.send_failed': '❌ Fallo al enviar: {error}',
    'sys.sas_mismatch': '⚠️ Los números de seguridad no coincidieron — finalizando la llamada por precaución.',
    'sys.pip_unsupported': '⚠️ Imagen en imagen no es compatible con este dispositivo.',
    'sys.pip_error': '⚠️ No se pudo activar Imagen en imagen. Pulsa el botón PiP durante la llamada.',

    'err.reconnect_failed': 'No se pudo reconectar al servidor de señalización. Inténtalo de nuevo.',
    'err.permissions': 'Acceso a cámara/micrófono denegado. Concede los permisos e inténtalo de nuevo.',
    'err.connect_failed': 'No se pudo establecer la conexión. Inténtalo de nuevo.',
    'err.custom_length': 'Los códigos personalizados deben tener entre 4 y 10 caracteres.',
    'err.no_server': 'No se pudo conectar al servidor de señalización. ¿Está desplegado?',
    'err.invalid_code': 'Introduce un código válido (4–10 caracteres).',

    'file.sending': 'Enviando {name}: {pct}%',
    'file.receiving': 'Recibiendo {name}: {pct}%',

    'a11y.lang_changed': 'Idioma cambiado a {lang}',
  },

  // ─── French ───────────────────────────────────────────────────────────────
  fr: {
    'home.tagline_sub': 'Chiffré de pair à pair',
    'home.h1a': 'Appels privés.',
    'home.h1b': 'Sans intermédiaire.',
    'home.hero_sub': 'Vos audio, vidéo et fichiers transitent directement entre navigateurs — entièrement chiffrés, invisibles pour le serveur et sans laisser de trace.',
    'home.create': 'Créer un salon',
    'home.use_custom': 'Utiliser un code personnalisé',
    'home.custom_hint': '4 à 10 caractères · lettres et chiffres · vos amis l’utiliseront pour vous rejoindre',
    'home.divider': 'ou rejoignez avec un code',
    'home.join': 'Rejoindre',
    'home.password_placeholder': 'Mot de passe du salon (facultatif)',
    'home.password_hint': 'Les deux doivent saisir le même mot de passe · renforce la clé de chiffrement',
    'home.badge_zero': 'Aucune donnée serveur',
    'home.connecting': 'Connexion au serveur…',
    'home.connecting_cold': 'Le serveur peut mettre ~30 s à démarrer la première fois…',
    'home.connecting_join': 'Connexion au salon…',
    'home.lang_label': 'Langue',
    'home.theme_label': 'Changer de thème',

    'lobby.share_code': 'Partagez ce code avec votre correspondant',
    'lobby.copy': 'Copier le code',
    'lobby.copied': 'Copié !',
    'lobby.code_changes_1': 'Si le code change après le partage,',
    'lobby.code_changes_2': 'utilisez le code copié pour rejoindre le salon',
    'lobby.share_link': 'Partager le lien',
    'lobby.share_title': 'Rejoignez mon appel Omni',
    'lobby.share_text': 'Rejoignez mon appel chiffré',
    'lobby.link_copied': 'Lien copié !',
    'lobby.scan': 'Scannez pour rejoindre depuis un autre appareil',
    'lobby.waiting': 'En attente de votre correspondant…',
    'lobby.cancel': 'Annuler',
    'lobby.new_room': 'Nouveau salon créé. Partagez le code mis à jour…',
    'lobby.custom_ready': 'Votre code personnalisé est prêt. Partagez-le avec votre correspondant…',
    'lobby.reconnected': 'Reconnecté. Toujours en attente du correspondant…',
    'lobby.session_expired': 'Session expirée. Création d’un nouveau salon…',
    'lobby.reconnecting': 'Connexion perdue. Reconnexion… (tentative {attempt}/{max})',
    'lobby.peer_found': 'Correspondant trouvé. Établissement de la connexion chiffrée…',

    'call.waiting_video': 'En attente de la vidéo…',
    'call.muted': 'Votre micro est coupé',
    'call.drop': 'Déposez des fichiers à envoyer',

    'ctrl.mute': 'Couper',
    'ctrl.camera': 'Caméra',
    'ctrl.screen': 'Écran',
    'ctrl.stop': 'Arrêter',
    'ctrl.flip': 'Pivoter',
    'ctrl.pip': 'PiP',
    'ctrl.record': 'Enregistrer',
    'ctrl.end': 'Raccrocher',
    'ctrl.file': 'Fichier',
    'ctrl.more': 'Plus',
    'ctrl.more_title': 'Plus d’options',
    'ctrl.mute_title': 'Activer/couper le micro',
    'ctrl.camera_title': 'Activer/désactiver la caméra',
    'ctrl.screen_title': 'Partager l’écran',
    'ctrl.flip_title': 'Pivoter la caméra',
    'ctrl.pip_title': 'Image dans l’image',
    'ctrl.record_title': 'Enregistrer l’appel (sauvegarde locale)',
    'ctrl.end_title': 'Terminer l’appel',
    'ctrl.file_title': 'Envoyer des fichiers',
    'ctrl.send_label': 'Envoyer le message',

    'badge.quality_title': 'Qualité de la connexion',
    'badge.enc_title': 'État du chiffrement',

    'chat.title': 'Discussion',
    'chat.clear': 'Effacer',
    'chat.clear_title': 'Effacer la discussion',
    'chat.establishing': 'Connexion en cours… la discussion sera disponible une fois le canal chiffré prêt.',
    'chat.typing': 'Le correspondant écrit',
    'chat.placeholder': 'Écrivez un message… (Entrée pour envoyer)',
    'chat.you': 'Vous',
    'chat.peer': 'Correspondant',

    'sas.title': 'Vérifiez votre correspondant',
    'sas.hint': 'Comparez-les à voix haute. S’ils correspondent, personne n’intercepte.',
    'sas.match': 'Ils correspondent',
    'sas.nomatch': 'Ne correspondent pas',

    'conn.connected': 'Connecté',
    'conn.reconnecting': 'Reconnexion…',
    'conn.connecting': 'Connexion…',
    'conn.disconnected': 'Déconnecté',
    'conn.failed': 'Échec',
    'conn.new': 'Préparation…',

    'sys.peer_disconnected': 'Le correspondant s’est déconnecté.',
    'sys.audio_only': '⚠️ Aucune caméra disponible — connexion en audio seulement.',
    'sys.channel_ready': '🔒 Canal chiffré établi.',
    'sys.network_changed': '⟳ Réseau changé — reconnexion…',
    'sys.rx_streaming': '📎 Réception de « {name} » ({size}) — enregistrement sur le disque…',
    'sys.save_cancelled': '⚠️ Enregistrement annulé — réception en mémoire.',
    'sys.rx_large_warn': '⚠️ Le fichier fait {size}. Utilisez Chrome ou Edge pour les gros fichiers afin d’éviter de manquer de mémoire.',
    'sys.rx_receiving': '📎 Réception de « {name} » ({size})…',
    'sys.integrity_fail_saved': '❌ Échec du contrôle d’intégrité de « {name} ». Fichier enregistré mais peut-être corrompu.',
    'sys.saved_verified': '✓ « {name} » enregistré sur le disque. SHA-256 vérifié.',
    'sys.integrity_fail': '❌ Échec du contrôle d’intégrité de « {name} ». Le fichier est peut-être corrompu.',
    'sys.wrong_password': '❌ Mauvais mot de passe du salon — canal privé impossible. Fin de l’appel.',
    'sys.send_failed_notready': '⚠️ Échec de l’envoi — le canal n’est pas encore prêt.',
    'sys.screen_unsupported': '⚠️ Le partage d’écran n’est pas pris en charge sur cet appareil.',
    'sys.record_unsupported': '⚠️ L’enregistrement n’est pas pris en charge sur ce navigateur.',
    'sys.record_started': '🔴 Enregistrement démarré (sauvegarde locale uniquement).',
    'sys.record_error': '⚠️ Impossible de démarrer l’enregistrement : {error}',
    'sys.record_nodata': '⚠️ L’enregistrement n’a produit aucune donnée.',
    'sys.record_saved': '💾 Enregistrement sauvegardé ({size}).',
    'sys.chat_cleared': 'Discussion effacée. Les messages ne sont jamais stockés — ils disparaissent quand vous partez.',
    'sys.sending': '📤 Envoi de « {name} » ({size})…',
    'sys.sent': '✓ « {name} » envoyé.',
    'sys.send_failed': '❌ Échec de l’envoi : {error}',
    'sys.sas_mismatch': '⚠️ Les numéros de sécurité ne correspondaient pas — fin de l’appel par précaution.',
    'sys.pip_unsupported': '⚠️ L’image dans l’image n’est pas prise en charge sur cet appareil.',
    'sys.pip_error': '⚠️ Impossible d’activer l’image dans l’image. Appuyez sur le bouton PiP pendant l’appel.',

    'err.reconnect_failed': 'Reconnexion au serveur de signalisation impossible. Veuillez réessayer.',
    'err.permissions': 'Accès caméra/micro refusé. Autorisez les permissions et réessayez.',
    'err.connect_failed': 'Impossible d’établir la connexion. Veuillez réessayer.',
    'err.custom_length': 'Les codes personnalisés doivent comporter entre 4 et 10 caractères.',
    'err.no_server': 'Connexion au serveur de signalisation impossible. Est-il déployé ?',
    'err.invalid_code': 'Saisissez un code valide (4 à 10 caractères).',

    'file.sending': 'Envoi de {name} : {pct} %',
    'file.receiving': 'Réception de {name} : {pct} %',

    'a11y.lang_changed': 'Langue changée en {lang}',
  },

  // ─── German ───────────────────────────────────────────────────────────────
  de: {
    'home.tagline_sub': 'Verschlüsselt, Ende-zu-Ende',
    'home.h1a': 'Private Anrufe.',
    'home.h1b': 'Ohne Mittelsmann.',
    'home.hero_sub': 'Audio, Video und Dateien wandern direkt zwischen Browsern — vollständig verschlüsselt, für den Server unsichtbar und ohne Spuren.',
    'home.create': 'Raum erstellen',
    'home.use_custom': 'Eigenen Code verwenden',
    'home.custom_hint': '4–10 Zeichen · Buchstaben & Zahlen · damit treten deine Freunde bei',
    'home.divider': 'oder mit einem Code beitreten',
    'home.join': 'Beitreten',
    'home.password_placeholder': 'Raum-Passwort (optional)',
    'home.password_hint': 'Beide müssen dasselbe Passwort eingeben · verstärkt den Verschlüsselungsschlüssel',
    'home.badge_zero': 'Keine Serverdaten',
    'home.connecting': 'Verbinde mit Server…',
    'home.connecting_cold': 'Der Server braucht beim ersten Verbinden evtl. ~30 s…',
    'home.connecting_join': 'Trete dem Raum bei…',
    'home.lang_label': 'Sprache',
    'home.theme_label': 'Design wechseln',

    'lobby.share_code': 'Teile diesen Code mit deinem Gegenüber',
    'lobby.copy': 'Code kopieren',
    'lobby.copied': 'Kopiert!',
    'lobby.code_changes_1': 'Falls sich der Code nach dem Teilen ändert,',
    'lobby.code_changes_2': 'nutze den kopierten Code, um dem Raum beizutreten',
    'lobby.share_link': 'Link teilen',
    'lobby.share_title': 'Tritt meinem Omni-Anruf bei',
    'lobby.share_text': 'Tritt meinem verschlüsselten Anruf bei',
    'lobby.link_copied': 'Link kopiert!',
    'lobby.scan': 'Scanne, um auf einem anderen Gerät beizutreten',
    'lobby.waiting': 'Warte auf das Gegenüber…',
    'lobby.cancel': 'Abbrechen',
    'lobby.new_room': 'Neuer Raum erstellt. Teile den aktualisierten Code…',
    'lobby.custom_ready': 'Dein eigener Code ist bereit. Teile ihn mit deinem Gegenüber…',
    'lobby.reconnected': 'Wieder verbunden. Warte weiter auf das Gegenüber…',
    'lobby.session_expired': 'Sitzung abgelaufen. Erstelle neuen Raum…',
    'lobby.reconnecting': 'Verbindung verloren. Verbinde erneut… (Versuch {attempt}/{max})',
    'lobby.peer_found': 'Gegenüber gefunden. Stelle verschlüsselte Verbindung her…',

    'call.waiting_video': 'Warte auf Video…',
    'call.muted': 'Du bist stummgeschaltet',
    'call.drop': 'Dateien zum Senden hier ablegen',

    'ctrl.mute': 'Stumm',
    'ctrl.camera': 'Kamera',
    'ctrl.screen': 'Bildschirm',
    'ctrl.stop': 'Stopp',
    'ctrl.flip': 'Wechseln',
    'ctrl.pip': 'PiP',
    'ctrl.record': 'Aufnahme',
    'ctrl.end': 'Auflegen',
    'ctrl.file': 'Datei',
    'ctrl.more': 'Mehr',
    'ctrl.more_title': 'Weitere Optionen',
    'ctrl.mute_title': 'Mikrofon ein/aus',
    'ctrl.camera_title': 'Kamera ein/aus',
    'ctrl.screen_title': 'Bildschirm teilen',
    'ctrl.flip_title': 'Kamera wechseln',
    'ctrl.pip_title': 'Bild-in-Bild',
    'ctrl.record_title': 'Anruf aufnehmen (lokal gespeichert)',
    'ctrl.end_title': 'Anruf beenden',
    'ctrl.file_title': 'Dateien senden',
    'ctrl.send_label': 'Nachricht senden',

    'badge.quality_title': 'Verbindungsqualität',
    'badge.enc_title': 'Verschlüsselungsstatus',

    'chat.title': 'Chat',
    'chat.clear': 'Leeren',
    'chat.clear_title': 'Chat leeren',
    'chat.establishing': 'Verbindung wird aufgebaut… der Chat ist verfügbar, sobald der verschlüsselte Kanal bereit ist.',
    'chat.typing': 'Gegenüber schreibt',
    'chat.placeholder': 'Nachricht schreiben… (Enter zum Senden)',
    'chat.you': 'Du',
    'chat.peer': 'Gegenüber',

    'sas.title': 'Verifiziere dein Gegenüber',
    'sas.hint': 'Lest sie laut vor. Stimmen sie überein, hört niemand mit.',
    'sas.match': 'Stimmen überein',
    'sas.nomatch': 'Stimmen nicht',

    'conn.connected': 'Verbunden',
    'conn.reconnecting': 'Verbinde erneut…',
    'conn.connecting': 'Verbinde…',
    'conn.disconnected': 'Getrennt',
    'conn.failed': 'Fehlgeschlagen',
    'conn.new': 'Wird eingerichtet…',

    'sys.peer_disconnected': 'Gegenüber hat die Verbindung getrennt.',
    'sys.audio_only': '⚠️ Keine Kamera verfügbar — Beitritt nur mit Audio.',
    'sys.channel_ready': '🔒 Verschlüsselter Kanal hergestellt.',
    'sys.network_changed': '⟳ Netzwerk gewechselt — verbinde erneut…',
    'sys.rx_streaming': '📎 Empfange „{name}“ ({size}) — wird auf die Festplatte geschrieben…',
    'sys.save_cancelled': '⚠️ Speichern abgebrochen — empfange stattdessen im Speicher.',
    'sys.rx_large_warn': '⚠️ Die Datei ist {size} groß. Nutze für große Dateien Chrome oder Edge, um Speicherprobleme zu vermeiden.',
    'sys.rx_receiving': '📎 Empfange „{name}“ ({size})…',
    'sys.integrity_fail_saved': '❌ Integritätsprüfung für „{name}“ FEHLGESCHLAGEN. Datei gespeichert, könnte aber beschädigt sein.',
    'sys.saved_verified': '✓ „{name}“ auf der Festplatte gespeichert. SHA-256 verifiziert.',
    'sys.integrity_fail': '❌ Integritätsprüfung für „{name}“ FEHLGESCHLAGEN. Datei könnte beschädigt sein.',
    'sys.wrong_password': '❌ Falsches Raum-Passwort — kein privater Kanal möglich. Anruf wird beendet.',
    'sys.send_failed_notready': '⚠️ Senden fehlgeschlagen — Kanal noch nicht bereit.',
    'sys.screen_unsupported': '⚠️ Bildschirmfreigabe wird auf diesem Gerät nicht unterstützt.',
    'sys.record_unsupported': '⚠️ Aufnahme wird in diesem Browser nicht unterstützt.',
    'sys.record_started': '🔴 Aufnahme gestartet (nur lokal gespeichert).',
    'sys.record_error': '⚠️ Aufnahme konnte nicht gestartet werden: {error}',
    'sys.record_nodata': '⚠️ Aufnahme lieferte keine Daten.',
    'sys.record_saved': '💾 Aufnahme gespeichert ({size}).',
    'sys.chat_cleared': 'Chat geleert. Nachrichten werden nie gespeichert — sie verschwinden, wenn du gehst.',
    'sys.sending': '📤 Sende „{name}“ ({size})…',
    'sys.sent': '✓ „{name}“ gesendet.',
    'sys.send_failed': '❌ Senden fehlgeschlagen: {error}',
    'sys.sas_mismatch': '⚠️ Sicherheitsnummern stimmten nicht überein — Anruf wird vorsichtshalber beendet.',
    'sys.pip_unsupported': '⚠️ Bild-in-Bild wird auf diesem Gerät nicht unterstützt.',
    'sys.pip_error': '⚠️ Bild-in-Bild konnte nicht gestartet werden. Tippe während des Anrufs auf die PiP-Taste.',

    'err.reconnect_failed': 'Verbindung zum Signalisierungsserver fehlgeschlagen. Bitte erneut versuchen.',
    'err.permissions': 'Kamera-/Mikrofonzugriff verweigert. Bitte Berechtigungen erlauben und erneut versuchen.',
    'err.connect_failed': 'Verbindung konnte nicht hergestellt werden. Bitte erneut versuchen.',
    'err.custom_length': 'Eigene Codes müssen zwischen 4 und 10 Zeichen lang sein.',
    'err.no_server': 'Verbindung zum Signalisierungsserver fehlgeschlagen. Ist er bereitgestellt?',
    'err.invalid_code': 'Gib einen gültigen Code ein (4–10 Zeichen).',

    'file.sending': 'Sende {name}: {pct} %',
    'file.receiving': 'Empfange {name}: {pct} %',

    'a11y.lang_changed': 'Sprache geändert zu {lang}',
  },

  // ─── Hindi ────────────────────────────────────────────────────────────────
  hi: {
    'home.tagline_sub': 'एन्क्रिप्टेड पीयर-टू-पीयर',
    'home.h1a': 'निजी कॉल।',
    'home.h1b': 'कोई बिचौलिया नहीं।',
    'home.hero_sub': 'आपका ऑडियो, वीडियो और फ़ाइलें सीधे ब्राउज़रों के बीच जाती हैं — पूरी तरह एन्क्रिप्टेड, सर्वर से अदृश्य और बिना कोई निशान छोड़े।',
    'home.create': 'रूम बनाएं',
    'home.use_custom': 'कस्टम कोड इस्तेमाल करें',
    'home.custom_hint': '4-10 अक्षर · अक्षर और संख्याएं · आपके दोस्त इससे जुड़ेंगे',
    'home.divider': 'या कोड से जुड़ें',
    'home.join': 'जुड़ें',
    'home.password_placeholder': 'रूम पासवर्ड (वैकल्पिक)',
    'home.password_hint': 'दोनों को एक ही पासवर्ड डालना होगा · एन्क्रिप्शन की मज़बूत करता है',
    'home.badge_zero': 'शून्य सर्वर डेटा',
    'home.connecting': 'सर्वर से कनेक्ट हो रहा है…',
    'home.connecting_cold': 'पहली बार कनेक्ट होने में सर्वर को ~30 सेकंड लग सकते हैं…',
    'home.connecting_join': 'रूम में जुड़ रहे हैं…',
    'home.lang_label': 'भाषा',
    'home.theme_label': 'थीम बदलें',

    'lobby.share_code': 'यह कोड अपने साथी के साथ साझा करें',
    'lobby.copy': 'कोड कॉपी करें',
    'lobby.copied': 'कॉपी हो गया!',
    'lobby.code_changes_1': 'अगर साझा करने के बाद कोड बदल जाए,',
    'lobby.code_changes_2': 'तो जुड़ने के लिए अपना कॉपी किया कोड इस्तेमाल करें',
    'lobby.share_link': 'लिंक साझा करें',
    'lobby.share_title': 'मेरी Omni कॉल में जुड़ें',
    'lobby.share_text': 'मेरी एन्क्रिप्टेड कॉल में जुड़ें',
    'lobby.link_copied': 'लिंक कॉपी हो गया!',
    'lobby.scan': 'दूसरे डिवाइस पर जुड़ने के लिए स्कैन करें',
    'lobby.waiting': 'साथी के जुड़ने का इंतज़ार…',
    'lobby.cancel': 'रद्द करें',
    'lobby.new_room': 'नया रूम बना। अपडेटेड कोड साझा करें…',
    'lobby.custom_ready': 'आपका कस्टम कोड तैयार है। इसे अपने साथी के साथ साझा करें…',
    'lobby.reconnected': 'फिर से जुड़ गए। अभी भी साथी का इंतज़ार…',
    'lobby.session_expired': 'सत्र समाप्त। नया रूम बना रहे हैं…',
    'lobby.reconnecting': 'कनेक्शन टूटा। फिर से जुड़ रहे हैं… (प्रयास {attempt}/{max})',
    'lobby.peer_found': 'साथी मिला। एन्क्रिप्टेड कनेक्शन बना रहे हैं…',

    'call.waiting_video': 'वीडियो का इंतज़ार…',
    'call.muted': 'आप म्यूट हैं',
    'call.drop': 'भेजने के लिए फ़ाइलें यहां छोड़ें',

    'ctrl.mute': 'म्यूट',
    'ctrl.camera': 'कैमरा',
    'ctrl.screen': 'स्क्रीन',
    'ctrl.stop': 'रोकें',
    'ctrl.flip': 'पलटें',
    'ctrl.pip': 'PiP',
    'ctrl.record': 'रिकॉर्ड',
    'ctrl.end': 'समाप्त',
    'ctrl.file': 'फ़ाइल',
    'ctrl.more': 'और',
    'ctrl.more_title': 'अधिक विकल्प',
    'ctrl.mute_title': 'माइक्रोफ़ोन चालू/बंद करें',
    'ctrl.camera_title': 'कैमरा चालू/बंद करें',
    'ctrl.screen_title': 'स्क्रीन साझा करें',
    'ctrl.flip_title': 'कैमरा पलटें',
    'ctrl.pip_title': 'पिक्चर-इन-पिक्चर',
    'ctrl.record_title': 'कॉल रिकॉर्ड करें (स्थानीय रूप से सहेजी गई)',
    'ctrl.end_title': 'कॉल समाप्त करें',
    'ctrl.file_title': 'फ़ाइलें भेजें',
    'ctrl.send_label': 'संदेश भेजें',

    'badge.quality_title': 'कनेक्शन गुणवत्ता',
    'badge.enc_title': 'एन्क्रिप्शन स्थिति',

    'chat.title': 'चैट',
    'chat.clear': 'साफ़ करें',
    'chat.clear_title': 'चैट साफ़ करें',
    'chat.establishing': 'कनेक्शन बन रहा है… एन्क्रिप्टेड चैनल तैयार होते ही चैट उपलब्ध होगी।',
    'chat.typing': 'साथी टाइप कर रहा है',
    'chat.placeholder': 'संदेश लिखें… (भेजने के लिए Enter)',
    'chat.you': 'आप',
    'chat.peer': 'साथी',

    'sas.title': 'अपने साथी को सत्यापित करें',
    'sas.hint': 'इन्हें ज़ोर से मिलाएं। अगर ये मेल खाते हैं, तो कोई बीच में नहीं है।',
    'sas.match': 'ये मेल खाते हैं',
    'sas.nomatch': 'मेल नहीं खाते',

    'conn.connected': 'जुड़ा हुआ',
    'conn.reconnecting': 'फिर से जुड़ रहे हैं…',
    'conn.connecting': 'जुड़ रहे हैं…',
    'conn.disconnected': 'डिस्कनेक्ट',
    'conn.failed': 'विफल',
    'conn.new': 'सेटअप हो रहा है…',

    'sys.peer_disconnected': 'साथी डिस्कनेक्ट हो गया।',
    'sys.audio_only': '⚠️ कैमरा उपलब्ध नहीं — केवल ऑडियो से जुड़ रहे हैं।',
    'sys.channel_ready': '🔒 एन्क्रिप्टेड चैनल बन गया।',
    'sys.network_changed': '⟳ नेटवर्क बदला — फिर से जुड़ रहे हैं…',
    'sys.rx_streaming': '📎 “{name}” ({size}) प्राप्त हो रही है — डिस्क पर सहेजी जा रही है…',
    'sys.save_cancelled': '⚠️ सहेजना रद्द — मेमोरी में प्राप्त कर रहे हैं।',
    'sys.rx_large_warn': '⚠️ फ़ाइल {size} की है। बड़ी फ़ाइलों के लिए Chrome या Edge इस्तेमाल करें ताकि मेमोरी न भरे।',
    'sys.rx_receiving': '📎 “{name}” ({size}) प्राप्त हो रही है…',
    'sys.integrity_fail_saved': '❌ “{name}” की अखंडता जांच विफल। फ़ाइल सहेजी गई पर खराब हो सकती है।',
    'sys.saved_verified': '✓ “{name}” डिस्क पर सहेजी गई। SHA-256 सत्यापित।',
    'sys.integrity_fail': '❌ “{name}” की अखंडता जांच विफल। फ़ाइल खराब हो सकती है।',
    'sys.wrong_password': '❌ गलत रूम पासवर्ड — निजी चैनल नहीं बन सका। कॉल समाप्त हो रही है।',
    'sys.send_failed_notready': '⚠️ भेजना विफल — चैनल अभी तैयार नहीं है।',
    'sys.screen_unsupported': '⚠️ इस डिवाइस पर स्क्रीन साझा करना समर्थित नहीं है।',
    'sys.record_unsupported': '⚠️ इस ब्राउज़र पर रिकॉर्डिंग समर्थित नहीं है।',
    'sys.record_started': '🔴 रिकॉर्डिंग शुरू (केवल स्थानीय रूप से सहेजी गई)।',
    'sys.record_error': '⚠️ रिकॉर्डिंग शुरू नहीं हो सकी: {error}',
    'sys.record_nodata': '⚠️ रिकॉर्डिंग में कोई डेटा नहीं।',
    'sys.record_saved': '💾 रिकॉर्डिंग सहेजी गई ({size})।',
    'sys.chat_cleared': 'चैट साफ़ हो गई। संदेश कभी संग्रहीत नहीं होते — आपके जाते ही मिट जाते हैं।',
    'sys.sending': '📤 “{name}” ({size}) भेजी जा रही है…',
    'sys.sent': '✓ “{name}” भेज दी।',
    'sys.send_failed': '❌ भेजना विफल: {error}',
    'sys.sas_mismatch': '⚠️ सुरक्षा नंबर मेल नहीं खाए — एहतियातन कॉल समाप्त हो रही है।',
    'sys.pip_unsupported': '⚠️ इस डिवाइस पर पिक्चर-इन-पिक्चर समर्थित नहीं है।',
    'sys.pip_error': '⚠️ पिक्चर-इन-पिक्चर शुरू नहीं हो सका। कॉल के दौरान PiP बटन दबाएं।',

    'err.reconnect_failed': 'सिग्नलिंग सर्वर से फिर नहीं जुड़ सके। कृपया दोबारा कोशिश करें।',
    'err.permissions': 'कैमरा/माइक एक्सेस अस्वीकृत। कृपया अनुमति दें और दोबारा कोशिश करें।',
    'err.connect_failed': 'कनेक्शन स्थापित नहीं हो सका। कृपया दोबारा कोशिश करें।',
    'err.custom_length': 'कस्टम कोड 4 से 10 अक्षरों के बीच होने चाहिए।',
    'err.no_server': 'सिग्नलिंग सर्वर से कनेक्ट नहीं हो सका। क्या यह डिप्लॉय है?',
    'err.invalid_code': 'मान्य कोड डालें (4–10 अक्षर)।',

    'file.sending': '{name} भेजी जा रही: {pct}%',
    'file.receiving': '{name} प्राप्त हो रही: {pct}%',

    'a11y.lang_changed': 'भाषा बदलकर {lang} कर दी गई',
  },
};

function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch { /* no localStorage (SSR/tests) */ }
  try {
    const navLangs = navigator.languages || [navigator.language];
    for (const l of navLangs) {
      const code = String(l).slice(0, 2).toLowerCase();
      if (SUPPORTED.includes(code)) return code;
    }
  } catch { /* no navigator */ }
  return 'en';
}

let current = detectLanguage();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  if (!SUPPORTED.includes(code)) code = 'en';
  current = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  return current;
}

/** Translate a key, interpolating {placeholder} params. Falls back en → key. */
export function t(key, params) {
  const table = translations[current] || translations.en;
  let str = table[key] != null ? table[key]
          : (translations.en[key] != null ? translations.en[key] : key);
  if (params) {
    for (const k in params) str = str.split('{' + k + '}').join(String(params[k]));
  }
  return str;
}

/** Fill all `data-i18n*` attributes under `root` with the current language. */
export function applyTranslations(root = document) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
}

// Exposed for tests / introspection.
export const _translations = translations;
