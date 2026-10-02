<?php
/**
 * Wires the parts of the plugin together.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Each part registers its own hooks; this class only creates them once.
 */
final class Emojisense_Plugin {

	/**
	 * The instance.
	 *
	 * @var Emojisense_Plugin|null
	 */
	private static $instance = null;

	/**
	 * Whether register() ran.
	 *
	 * @var bool
	 */
	private $registered = false;

	/**
	 * The instance.
	 *
	 * @return Emojisense_Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Registers the hooks of every part, once.
	 */
	public function register() {
		if ( $this->registered ) {
			return;
		}
		$this->registered = true;

		$parts = array(
			new Emojisense_Admin(),
			new Emojisense_Editor(),
			new Emojisense_Reactions(),
			new Emojisense_Comments(),
			new Emojisense_Emoji_Set(),
			new Emojisense_Privacy(),
		);
		foreach ( $parts as $part ) {
			$part->register();
		}
		register_deactivation_hook( EMOJISENSE_FILE, array( __CLASS__, 'deactivate' ) );
	}

	/**
	 * Removes scheduled suggestion jobs. Settings and reactions stay until the plugin is deleted
	 * (uninstall.php).
	 */
	public static function deactivate() {
		wp_unschedule_hook( Emojisense_Reactions::CRON_SUGGEST );
	}
}
