<?php
/**
 * Plugin Name:       Emojisense
 * Plugin URI:        https://emojisense.com/docs/integrations/wordpress/
 * Description:       Find emoji by meaning: type a colon in the block editor, use the emoji button in the classic editor, and add emoji reactions and an emoji picker to comments. Search runs on your server's files, with optional meaning search through the Emojisense API.
 * Version:           0.1.0
 * Requires at least: 6.6
 * Requires PHP:      7.4
 * Author:            Emojisense
 * Author URI:        https://emojisense.com
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       emojisense
 * Domain Path:       /languages
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

define( 'EMOJISENSE_VERSION', '0.1.0' );
define( 'EMOJISENSE_FILE', __FILE__ );
define( 'EMOJISENSE_DIR', plugin_dir_path( __FILE__ ) );
define( 'EMOJISENSE_URL', plugin_dir_url( __FILE__ ) );
/** Version of the bundled data packs in packs/ (the `packVersion` of the Emojisense data). */
define( 'EMOJISENSE_PACK_VERSION', '0.1.0' );

require_once EMOJISENSE_DIR . 'includes/class-emojisense-settings.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-api-client.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-assets.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-admin.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-editor.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-reactions.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-comments.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-emoji-set.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-privacy.php';
require_once EMOJISENSE_DIR . 'includes/class-emojisense-plugin.php';

Emojisense_Plugin::instance()->register();
