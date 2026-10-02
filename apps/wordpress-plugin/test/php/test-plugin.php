<?php
/**
 * Hosted emoji sets, editor hooks, privacy text and uninstall.
 *
 * @package Emojisense
 */

/**
 * The smaller parts of the plugin.
 */
class Test_Emojisense_Plugin extends WP_UnitTestCase {

	/**
	 * Fresh settings.
	 */
	public function set_up() {
		parent::set_up();
		delete_option( Emojisense_Settings::OPTION );
	}

	/**
	 * Code points as the API expects them.
	 */
	public function test_hexcode() {
		$this->assertSame( '1F355', Emojisense_Emoji_Set::hexcode( '🍕' ) );
		$this->assertSame( '2764-FE0F', Emojisense_Emoji_Set::hexcode( '❤️' ) );
		$this->assertSame( '1F44D-1F3FD', Emojisense_Emoji_Set::hexcode( '👍🏽' ) );
		$this->assertSame( '31-FE0F-20E3', Emojisense_Emoji_Set::hexcode( '1️⃣' ) );
		$this->assertSame( 'https://api.emojisense.com/v1/sets/fluent/1F355.svg', Emojisense_Emoji_Set::image_url( '🍕', 'fluent' ) );
	}

	/**
	 * With a hosted set, content emoji become the set's images; code stays text.
	 */
	public function test_staticize_content() {
		update_option(
			Emojisense_Settings::OPTION,
			array_merge(
				Emojisense_Settings::defaults(),
				array(
					'api_enabled' => true,
					'emoji_set'   => 'twemoji',
				)
			)
		);
		$set  = new Emojisense_Emoji_Set();
		$html = '<p>Pizza 🍕 time</p><code>🍕</code>';
		add_filter( 'emoji_url', array( $set, 'base_url' ) );
		add_filter( 'emoji_ext', array( $set, 'extension' ) );
		$out = $set->staticize( $html );
		$this->assertStringContainsString( 'src="https://api.emojisense.com/v1/sets/twemoji/1f355.svg"', $out );
		$this->assertStringContainsString( '<code>', $out );
		$this->assertSame( 1, substr_count( $out, '<img' ) );
	}

	/**
	 * Native: no filters, no external images.
	 */
	public function test_native_set_adds_no_filters() {
		$set = new Emojisense_Emoji_Set();
		$set->register_filters();
		$this->assertFalse( has_filter( 'emoji_url', array( $set, 'base_url' ) ) );
		$this->assertFalse( has_filter( 'the_content', array( $set, 'staticize' ) ) );
	}

	/**
	 * The TinyMCE button goes after "link".
	 */
	public function test_tinymce_button() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$editor  = new Emojisense_Editor();
		$buttons = $editor->add_tinymce_button( array( 'bold', 'link', 'wp_more' ) );
		$this->assertSame( array( 'bold', 'link', 'emojisense', 'wp_more' ), $buttons );
		$this->assertSame( $buttons, $editor->add_tinymce_button( $buttons ), 'added once' );
		$plugins = $editor->add_tinymce_plugin( array() );
		$this->assertStringContainsString( 'build/classic.js?ver=', $plugins['emojisense'] );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertSame( array( 'bold' ), $editor->add_tinymce_button( array( 'bold' ) ) );
	}

	/**
	 * The privacy text names the API address and what is sent.
	 */
	public function test_privacy_text() {
		$text = Emojisense_Privacy::policy_text();
		$this->assertStringContainsString( 'https://api.emojisense.com', $text );
		$this->assertStringContainsString( 'keyed hash of your IP address', $text );
		$this->assertSame( $text, wp_kses_post( $text ) );
	}

	/**
	 * Deleting the plugin removes its option and post meta.
	 */
	public function test_uninstall() {
		update_option( Emojisense_Settings::OPTION, Emojisense_Settings::defaults() );
		$post_id = self::factory()->post->create();
		update_post_meta( $post_id, Emojisense_Reactions::META_COUNTS, array( '👍' => 3 ) );
		update_post_meta( $post_id, Emojisense_Reactions::META_SET, array( '👍' ) );
		update_post_meta( $post_id, Emojisense_Reactions::META_SUGGESTED, array( '🎉' ) );

		if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
			define( 'WP_UNINSTALL_PLUGIN', 'emojisense/emojisense.php' );
		}
		require dirname( __DIR__, 2 ) . '/uninstall.php';

		$this->assertFalse( get_option( Emojisense_Settings::OPTION ) );
		$this->assertEmpty( get_post_meta( $post_id, Emojisense_Reactions::META_COUNTS, true ) );
		$this->assertEmpty( get_post_meta( $post_id, Emojisense_Reactions::META_SET, true ) );
		$this->assertEmpty( get_post_meta( $post_id, Emojisense_Reactions::META_SUGGESTED, true ) );
	}
}
