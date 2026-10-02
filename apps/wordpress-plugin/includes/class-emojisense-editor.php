<?php
/**
 * The block editor (colon autocomplete, toolbar picker, reactions panel) and the classic editor
 * (TinyMCE button).
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Editor integrations. All of them search the bundled packs; nothing leaves the site unless the
 * admin turned on search by meaning.
 */
class Emojisense_Editor {

	/** TinyMCE plugin and button name. */
	const TINYMCE_PLUGIN = 'emojisense';

	/**
	 * Hooks.
	 */
	public function register() {
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_block_editor' ) );
		add_filter( 'mce_external_plugins', array( $this, 'add_tinymce_plugin' ) );
		add_filter( 'mce_buttons', array( $this, 'add_tinymce_button' ) );
		add_action( 'wp_enqueue_editor', array( $this, 'enqueue_classic_config' ) );
	}

	/**
	 * Block editor script: the `:` completer, the toolbar button and the reactions panel.
	 */
	public function enqueue_block_editor() {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return;
		}
		$handle = Emojisense_Assets::enqueue( 'editor' );
		if ( '' === $handle ) {
			return;
		}
		Emojisense_Assets::add_config(
			$handle,
			array(
				'autocomplete'       => (bool) Emojisense_Settings::value( 'editor_autocomplete' ),
				'reactionPostTypes'  => Emojisense_Settings::reaction_post_types(),
				'defaultReactions'   => Emojisense_Settings::default_reactions(),
				'maxReactions'       => Emojisense_Settings::MAX_REACTIONS,
				'suggestions'        => Emojisense_Settings::suggestions_enabled(),
				'settingsUrl'        => current_user_can( 'manage_options' ) ? admin_url( 'options-general.php?page=emojisense' ) : '',
				'reactionSetMetaKey' => Emojisense_Reactions::META_SET,
			)
		);
	}

	/**
	 * Registers the TinyMCE plugin file.
	 *
	 * @param array<string,string> $plugins Plugin name => script URL.
	 * @return array<string,string>
	 */
	public function add_tinymce_plugin( $plugins ) {
		$asset_file = EMOJISENSE_DIR . 'build/classic.asset.php';
		if ( ! current_user_can( 'edit_posts' ) || ! file_exists( $asset_file ) ) {
			return $plugins;
		}
		$asset                           = require $asset_file;
		$plugins[ self::TINYMCE_PLUGIN ] = add_query_arg( 'ver', $asset['version'], EMOJISENSE_URL . 'build/classic.js' );
		return $plugins;
	}

	/**
	 * Puts the emoji button after the link button of the first toolbar row.
	 *
	 * @param string[] $buttons Button names.
	 * @return string[]
	 */
	public function add_tinymce_button( $buttons ) {
		if ( ! current_user_can( 'edit_posts' ) || in_array( self::TINYMCE_PLUGIN, $buttons, true ) ) {
			return $buttons;
		}
		$after = array_search( 'link', $buttons, true );
		if ( false === $after ) {
			$buttons[] = self::TINYMCE_PLUGIN;
		} else {
			array_splice( $buttons, (int) $after + 1, 0, array( self::TINYMCE_PLUGIN ) );
		}
		return $buttons;
	}

	/**
	 * The configuration and strings of the TinyMCE plugin. TinyMCE loads the plugin file itself,
	 * so this inline script carries what the PHP side knows.
	 */
	public function enqueue_classic_config() {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return;
		}
		$handle = 'emojisense-classic-config';
		if ( wp_script_is( $handle, 'enqueued' ) ) {
			return;
		}
		wp_register_script( $handle, false, array(), EMOJISENSE_VERSION, array( 'in_footer' => true ) );
		wp_enqueue_script( $handle );
		// The picker dialog style. The script itself is loaded by TinyMCE (add_tinymce_plugin).
		if ( '' !== Emojisense_Assets::register( 'classic' ) && wp_style_is( 'emojisense-classic', 'registered' ) ) {
			wp_enqueue_style( 'emojisense-classic' );
		}
		Emojisense_Assets::add_config(
			$handle,
			array(
				'strings' => array(
					'button'      => __( 'Insert emoji', 'emojisense' ),
					'dialog'      => __( 'Emoji picker', 'emojisense' ),
					'placeholder' => __( 'Search emoji by meaning…', 'emojisense' ),
				),
			)
		);
	}
}
