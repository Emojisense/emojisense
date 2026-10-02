<?php
/**
 * Settings: sanitization, defaults and derived values.
 *
 * @package Emojisense
 */

/**
 * Emojisense_Settings.
 */
class Test_Emojisense_Settings extends WP_UnitTestCase {

	/**
	 * Clears the option and the settings errors between tests.
	 */
	public function set_up() {
		parent::set_up();
		delete_option( Emojisense_Settings::OPTION );
		global $wp_settings_errors;
		$wp_settings_errors = array(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
	}

	/**
	 * A fresh install sends nothing anywhere.
	 */
	public function test_defaults_keep_everything_on_the_site() {
		$this->assertFalse( Emojisense_Settings::api_enabled() );
		$this->assertFalse( Emojisense_Settings::semantic_enabled() );
		$this->assertFalse( Emojisense_Settings::suggestions_enabled() );
		$this->assertSame( 'native', Emojisense_Settings::emoji_set() );
		$this->assertSame( array(), Emojisense_Settings::reaction_post_types() );

		$config = Emojisense_Assets::client_config();
		$this->assertSame( '', $config['endpoint'] );
		$this->assertSame( '', $config['key'] );
		$this->assertStringStartsWith( EMOJISENSE_URL, $config['packUrl'] );
		$this->assertStringStartsWith( EMOJISENSE_URL, $config['cultureUrl'] );
	}

	/**
	 * Checkboxes that are missing from the form are off.
	 */
	public function test_missing_checkboxes_are_off() {
		$clean = Emojisense_Settings::sanitize( array( 'api_enabled' => '1' ) );
		$this->assertTrue( $clean['api_enabled'] );
		$this->assertFalse( $clean['semantic_search'] );
		$this->assertFalse( $clean['culture'] );
		$this->assertFalse( $clean['comment_picker'] );
	}

	/**
	 * Publishable keys are stored; secret keys are refused with advice.
	 */
	public function test_keys() {
		$clean = Emojisense_Settings::sanitize( array( 'publishable_key' => ' pk_live_AbCdEf123456 ' ) );
		$this->assertSame( 'pk_live_AbCdEf123456', $clean['publishable_key'] );

		update_option( Emojisense_Settings::OPTION, $clean );
		$clean = Emojisense_Settings::sanitize( array( 'publishable_key' => 'sk_live_secret123456789' ) );
		$this->assertSame( 'pk_live_AbCdEf123456', $clean['publishable_key'], 'a secret key never replaces the stored key' );
		$errors = get_settings_errors( Emojisense_Settings::OPTION );
		$this->assertSame( 'emojisense_publishable_key', $errors[0]['code'] );
		$this->assertStringContainsString( 'secret key', $errors[0]['message'] );

		$clean = Emojisense_Settings::sanitize( array( 'publishable_key' => '<script>alert(1)</script>' ) );
		$this->assertSame( 'pk_live_AbCdEf123456', $clean['publishable_key'] );

		$clean = Emojisense_Settings::sanitize( array( 'publishable_key' => '' ) );
		$this->assertSame( '', $clean['publishable_key'], 'an empty field removes the key' );
	}

	/**
	 * The API address must be HTTPS (HTTP only for localhost) without credentials or a query.
	 *
	 * @dataProvider api_urls
	 *
	 * @param string $url      Input.
	 * @param string $expected Stored value.
	 */
	public function test_api_url( $url, $expected ) {
		$clean = Emojisense_Settings::sanitize( array( 'api_url' => $url ) );
		$this->assertSame( $expected, $clean['api_url'] );
	}

	/**
	 * Cases of test_api_url.
	 *
	 * @return array<string, array{string, string}>
	 */
	public function api_urls() {
		return array(
			'default when empty'   => array( '', 'https://api.emojisense.com' ),
			'self-hosted'          => array( 'https://emoji.example.com/', 'https://emoji.example.com' ),
			'local development'    => array( 'http://localhost:8788', 'http://localhost:8788' ),
			'plain http elsewhere' => array( 'http://api.example.com', 'https://api.emojisense.com' ),
			'credentials'          => array( 'https://user:pass@api.example.com', 'https://api.emojisense.com' ),
			'query'                => array( 'https://api.example.com/?x=1', 'https://api.emojisense.com' ),
			'javascript'           => array( 'javascript:alert(1)', 'https://api.emojisense.com' ),
		);
	}

	/**
	 * Lists and choices only keep known values.
	 */
	public function test_choices_are_validated() {
		register_post_type( 'private_thing', array( 'public' => false ) );
		$clean = Emojisense_Settings::sanitize(
			array(
				'emoji_set'            => 'comic-sans',
				'locale'               => 'xx',
				'reactions_post_types' => array( 'post', 'private_thing', 'nope', 'page' ),
				'default_reactions'    => '👍 hello ❤️ <b>x</b> 👍 🎉 🔥 😂 😮 😢 🙏 🚀',
			)
		);
		$this->assertSame( 'native', $clean['emoji_set'] );
		$this->assertSame( 'auto', $clean['locale'] );
		$this->assertSame( array( 'post', 'page' ), $clean['reactions_post_types'] );
		$this->assertSame( array( '👍', '❤️', '🎉', '🔥', '😂', '😮', '😢', '🙏' ), $clean['default_reactions'] );
		_unregister_post_type( 'private_thing' );
	}

	/**
	 * WordPress may sanitize an already sanitized value (first save, REST, CLI).
	 */
	public function test_sanitize_is_idempotent() {
		$once  = Emojisense_Settings::sanitize(
			array(
				'api_enabled'          => '1',
				'publishable_key'      => 'pk_live_AbCdEf123456',
				'emoji_set'            => 'noto',
				'locale'               => 'tr',
				'reactions_post_types' => array( 'post' ),
				'default_reactions'    => '👍 🎉',
			)
		);
		$twice = Emojisense_Settings::sanitize( $once );
		$this->assertSame( $once, $twice );
	}

	/**
	 * Site languages map to the pack languages.
	 */
	public function test_pack_locale() {
		$this->assertSame( 'pt', Emojisense_Settings::pack_locale( 'pt_BR' ) );
		$this->assertSame( 'zh', Emojisense_Settings::pack_locale( 'zh_TW' ) );
		$this->assertSame( 'tr', Emojisense_Settings::pack_locale( 'tr_TR' ) );
		$this->assertSame( 'en', Emojisense_Settings::pack_locale( 'de_DE' ) );
		$this->assertSame( 'en', Emojisense_Settings::pack_locale( '' ) );

		add_filter(
			'locale',
			static function () {
				return 'es_MX';
			}
		);
		$this->assertSame( 'es', Emojisense_Settings::locale(), 'auto follows the site language' );
	}

	/**
	 * Only emoji pass the emoji check.
	 */
	public function test_is_emoji() {
		foreach ( array( '👍', '❤️', '👍🏽', '🏳️‍🌈', '1️⃣', '🇹🇷', '👨‍👩‍👧', '©️' ) as $emoji ) {
			$this->assertTrue( Emojisense_Settings::is_emoji( $emoji ), $emoji );
		}
		foreach ( array( '', 'a', '12', '#', '<b>', '👍a', "👍\n", str_repeat( '👍', 20 ) ) as $text ) {
			$this->assertFalse( Emojisense_Settings::is_emoji( $text ), $text );
		}
	}

	/**
	 * The API settings take effect only with the connection on; the browser gets the address and
	 * key only with search by meaning on.
	 */
	public function test_api_switches() {
		update_option(
			Emojisense_Settings::OPTION,
			array_merge(
				Emojisense_Settings::defaults(),
				array(
					'publishable_key' => 'pk_live_AbCdEf123456',
					'emoji_set'       => 'noto',
				)
			)
		);
		$this->assertSame( 'native', Emojisense_Settings::emoji_set(), 'no hosted set without the connection' );

		update_option( Emojisense_Settings::OPTION, array_merge( Emojisense_Settings::get(), array( 'api_enabled' => true ) ) );
		$this->assertSame( 'noto', Emojisense_Settings::emoji_set() );
		$config = Emojisense_Assets::client_config();
		$this->assertSame( 'https://api.emojisense.com', $config['endpoint'] );
		$this->assertSame( 'pk_live_AbCdEf123456', $config['key'] );
		$this->assertSame( 'noto', $config['emojiSet'] );
		$this->assertSame( 'https://api.emojisense.com/v1/culture/' . EMOJISENSE_PACK_VERSION, $config['cultureUrl'] );

		update_option( Emojisense_Settings::OPTION, array_merge( Emojisense_Settings::get(), array( 'semantic_search' => false ) ) );
		$config = Emojisense_Assets::client_config();
		$this->assertSame( '', $config['endpoint'] );
		$this->assertSame( '', $config['key'] );
		$this->assertSame( 'native', $config['emojiSet'] );
	}

	/**
	 * The origins to allow on the key.
	 */
	public function test_site_origins() {
		$this->assertSame( 'https://example.com:8443', Emojisense_Settings::origin_of( 'https://Example.com:8443/blog/' ) );
		$this->assertSame( '', Emojisense_Settings::origin_of( '/relative' ) );
		$this->assertContains( Emojisense_Settings::origin_of( home_url() ), Emojisense_Settings::site_origins() );
	}
}
