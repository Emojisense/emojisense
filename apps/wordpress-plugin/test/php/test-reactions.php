<?php
/**
 * Reactions: the REST API, nonces, receipts, the limits, storage and the markup.
 *
 * @package Emojisense
 */

/**
 * Emojisense_Reactions.
 */
class Test_Emojisense_Reactions extends WP_Test_REST_TestCase {

	/**
	 * A published post.
	 *
	 * @var int
	 */
	private $post_id;

	/**
	 * The last receipt the site sent ('' clears it), and its cookie options.
	 *
	 * @var array{0: string, 1: array<string,mixed>}|null
	 */
	private $receipt;

	/**
	 * Settings with reactions on posts, and the meta registered for them.
	 */
	public function set_up() {
		parent::set_up();
		update_option(
			Emojisense_Settings::OPTION,
			array_merge( Emojisense_Settings::defaults(), array( 'reactions_post_types' => array( 'post' ) ) )
		);
		( new Emojisense_Reactions() )->register_meta();
		$this->post_id          = self::factory()->post->create(
			array(
				'post_title'   => 'We shipped the new onboarding',
				'post_content' => 'Thanks to everyone who helped!',
			)
		);
		$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
		wp_set_current_user( 0 );
		$this->receipt = null;
		add_action(
			'emojisense_set_receipt_cookie',
			function ( $value, $options ) {
				$this->receipt = array( $value, $options );
			},
			10,
			2
		);
	}

	/**
	 * Removes the HTTP mock, the limits and the cookie.
	 */
	public function tear_down() {
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'emojisense_reaction_rate_limit' );
		remove_all_filters( 'emojisense_reaction_object_limit' );
		remove_all_filters( 'emojisense_suggest_rate_limit' );
		remove_all_actions( 'emojisense_set_receipt_cookie' );
		unset( $_COOKIE[ Emojisense_Reactions::RECEIPT_COOKIE ], $_SERVER['HTTPS'] );
		parent::tear_down();
	}

	/**
	 * A REST request.
	 *
	 * @param string              $method  HTTP method.
	 * @param string              $route   Route under the namespace.
	 * @param array<string,mixed> $params  Body parameters.
	 * @param string|null         $nonce   X-Emojisense-Nonce header.
	 * @return WP_REST_Response
	 */
	private function request( $method, $route, $params = array(), $nonce = null ) {
		$request = new WP_REST_Request( $method, '/emojisense/v1' . $route );
		if ( $params ) {
			$request->set_header( 'Content-Type', 'application/json' );
			$request->set_body( wp_json_encode( $params ) );
		}
		if ( null !== $nonce ) {
			$request->set_header( 'X-Emojisense-Nonce', $nonce );
		}
		return rest_get_server()->dispatch( $request );
	}

	/**
	 * A reaction to the post from a browser that sends `$receipt` as its cookie (none when null).
	 * The receipt the site sends back is in `$this->receipt`.
	 *
	 * @param string      $emoji   Emoji.
	 * @param string      $action  "add" or "remove".
	 * @param string|null $receipt Receipt cookie.
	 * @return WP_REST_Response
	 */
	private function react( $emoji, $action = 'add', $receipt = null ) {
		unset( $_COOKIE[ Emojisense_Reactions::RECEIPT_COOKIE ] );
		if ( null !== $receipt ) {
			$_COOKIE[ Emojisense_Reactions::RECEIPT_COOKIE ] = $receipt;
		}
		$this->receipt = null;
		return $this->request(
			'POST',
			'/reactions/post/' . $this->post_id,
			array(
				'emoji'  => $emoji,
				'action' => $action,
			),
			wp_create_nonce( Emojisense_Reactions::NONCE_ACTION )
		);
	}

	/**
	 * Counts per emoji in a response.
	 *
	 * @param WP_REST_Response $response Response.
	 * @return array<string,int>
	 */
	private function counts_of( $response ) {
		$data = $response->get_data();
		return array_column( $data['reactions'], 'count', 'emoji' );
	}

	/**
	 * GET: the default reactions with zero counts and a nonce; shared caches may keep it briefly.
	 */
	public function test_get_returns_counts_and_a_nonce() {
		$response = $this->request( 'GET', '/reactions/post/' . $this->post_id );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( Emojisense_Settings::default_reactions(), array_column( $data['reactions'], 'emoji' ) );
		$this->assertSame( array( 0 ), array_values( array_unique( array_column( $data['reactions'], 'count' ) ) ) );
		$this->assertSame( 1, wp_verify_nonce( $data['nonce'], Emojisense_Reactions::NONCE_ACTION ) );
		$this->assertSame( 'public, max-age=0, s-maxage=10', $response->get_headers()['Cache-Control'] );

		// A logged-in request gets a nonce of that user: never in a shared cache.
		wp_set_current_user( self::factory()->user->create() );
		$response = $this->request( 'GET', '/reactions/post/' . $this->post_id );
		$this->assertSame( 'no-store', $response->get_headers()['Cache-Control'] );
	}

	/**
	 * Drafts, password-protected posts and post types without reactions have none.
	 */
	public function test_hidden_posts_have_no_reactions() {
		$draft     = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		$protected = self::factory()->post->create( array( 'post_password' => 'secret' ) );
		$page      = self::factory()->post->create( array( 'post_type' => 'page' ) );
		foreach ( array( $draft, $protected, $page, 999999 ) as $id ) {
			$this->assertSame( 404, $this->request( 'GET', '/reactions/post/' . $id )->get_status(), (string) $id );
		}
	}

	/**
	 * POST needs the nonce.
	 */
	public function test_react_needs_the_nonce() {
		$response = $this->request( 'POST', '/reactions/post/' . $this->post_id, array( 'emoji' => '👍' ) );
		$this->assertErrorResponse( 'emojisense_bad_nonce', $response, 403 );
		$response = $this->request( 'POST', '/reactions/post/' . $this->post_id, array( 'emoji' => '👍' ), 'forged' );
		$this->assertErrorResponse( 'emojisense_bad_nonce', $response, 403 );
		$this->assertSame( array(), Emojisense_Reactions::counts( $this->post_id ) );
	}

	/**
	 * A browser adds each emoji once and takes back what its receipt lists; only the offered
	 * reactions count.
	 */
	public function test_react_add_and_remove() {
		$_SERVER['HTTPS'] = 'on';
		$response         = $this->react( '❤️' );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 1, $this->counts_of( $response )['❤️'] );
		$this->assertSame( array( '❤️' ), $response->get_data()['mine'] );
		list( $receipt, $options ) = $this->receipt;
		$this->assertNotSame( '', $receipt );
		$this->assertTrue( $options['httponly'] );
		$this->assertTrue( $options['secure'] );
		$this->assertSame( 'Lax', $options['samesite'] );
		$this->assertSame( wp_parse_url( rest_url( 'emojisense/v1/reactions/' ), PHP_URL_PATH ), $options['path'] );
		$this->assertGreaterThan( time(), $options['expires'] );

		// The same browser cannot add it twice; another browser can.
		$response = $this->react( '❤️', 'add', $receipt );
		$this->assertErrorResponse( 'emojisense_already_reacted', $response, 409 );
		$this->assertSame( array( '❤️' ), $response->get_data()['data']['mine'] );
		$this->assertSame( 2, $this->counts_of( $this->react( '❤️' ) )['❤️'] );

		$response = $this->react( '😂', 'add', $receipt );
		$this->assertSame( array( '❤️', '😂' ), $response->get_data()['mine'] );
		$response = $this->react( '❤️', 'remove', $this->receipt[0] );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 1, $this->counts_of( $response )['❤️'] );
		$this->assertSame( array( '😂' ), $response->get_data()['mine'] );

		$response = $this->react( '😂', 'remove', $this->receipt[0] );
		$this->assertSame( 0, $this->counts_of( $response )['😂'] );
		$this->assertSame( '', $this->receipt[0] );
		$this->assertLessThan( time(), $this->receipt[1]['expires'] );

		$this->assertErrorResponse( 'emojisense_unknown_reaction', $this->react( '🍆' ), 400 );
		$this->assertSame( 400, $this->react( '<img src=x onerror=alert(1)>' )->get_status() );
	}

	/**
	 * The receipt keeps the most recent objects that fit in a cookie.
	 */
	public function test_receipt_keeps_the_newest_objects() {
		add_filter(
			'emojisense_reaction_rate_limit',
			static function () {
				return array(
					'limit'  => 1000,
					'window' => 60,
				);
			}
		);
		$posts   = self::factory()->post->create_many( 200 );
		$receipt = null;
		foreach ( $posts as $post_id ) {
			$this->post_id = $post_id;
			$this->react( '👍', 'add', $receipt );
			$receipt = $this->receipt[0];
		}
		$this->assertLessThanOrEqual( Emojisense_Reactions::RECEIPT_BYTES + 65, strlen( $receipt ) );
		$this->assertSame( 200, $this->react( '👍', 'remove', $receipt )->get_status() );
		$this->post_id = $posts[0];
		$this->assertErrorResponse( 'emojisense_not_reacted', $this->react( '👍', 'remove', $receipt ), 409 );
	}

	/**
	 * Without a receipt, nothing can be taken back: a script cannot empty the counts.
	 */
	public function test_remove_needs_a_receipt() {
		update_post_meta( $this->post_id, Emojisense_Reactions::META_COUNTS, array( '👍' => 3 ) );
		$response = $this->react( '👍', 'remove' );
		$this->assertErrorResponse( 'emojisense_not_reacted', $response, 409 );
		$this->assertSame( array(), $response->get_data()['data']['mine'] );
		$this->assertSame( array( '👍' => 3 ), Emojisense_Reactions::counts( $this->post_id ) );

		// A receipt for another post does not count here.
		$post_id       = $this->post_id;
		$this->post_id = self::factory()->post->create();
		$this->react( '👍' );
		$receipt       = $this->receipt[0];
		$this->post_id = $post_id;
		$this->assertErrorResponse( 'emojisense_not_reacted', $this->react( '👍', 'remove', $receipt ), 409 );
		$this->assertSame( array( '👍' => 3 ), Emojisense_Reactions::counts( $this->post_id ) );
	}

	/**
	 * A receipt with a wrong signature counts as none.
	 */
	public function test_tampered_receipt_is_rejected() {
		update_post_meta( $this->post_id, Emojisense_Reactions::META_COUNTS, array( '👍' => 3 ) );
		$this->react( '❤️' );
		list( $payload, $signature ) = explode( '.', $this->receipt[0] );

		$flipped = $payload . '.' . substr( $signature, 0, -1 ) . ( '0' === substr( $signature, -1 ) ? '1' : '0' );
		$this->assertErrorResponse( 'emojisense_not_reacted', $this->react( '❤️', 'remove', $flipped ), 409 );

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- the receipt encoding.
		$forged = rtrim( strtr( base64_encode( wp_json_encode( array( 'post:' . $this->post_id => array( '👍' ) ), JSON_UNESCAPED_UNICODE ) ), '+/', '-_' ), '=' );
		$this->assertErrorResponse( 'emojisense_not_reacted', $this->react( '👍', 'remove', $forged . '.' . $signature ), 409 );
		$this->assertErrorResponse( 'emojisense_not_reacted', $this->react( '👍', 'remove', 'garbage' ), 409 );
		$counts = Emojisense_Reactions::counts( $this->post_id );
		$this->assertSame( 3, $counts['👍'] );
		$this->assertSame( 1, $counts['❤️'] );
	}

	/**
	 * An old receipt, sent again, cannot take a reaction back twice.
	 */
	public function test_replayed_receipt_is_rejected() {
		update_post_meta( $this->post_id, Emojisense_Reactions::META_COUNTS, array( '❤️' => 5 ) );
		$this->react( '❤️' );
		$receipt = $this->receipt[0];
		$this->assertSame( 5, $this->counts_of( $this->react( '❤️', 'remove', $receipt ) )['❤️'] );

		$response = $this->react( '❤️', 'remove', $receipt );
		$this->assertErrorResponse( 'emojisense_not_reacted', $response, 409 );
		$this->assertSame( 5, Emojisense_Reactions::counts( $this->post_id )['❤️'] );
		// The site drops the reaction from that receipt.
		$this->assertSame( array(), $response->get_data()['data']['mine'] );
		$this->assertSame( '', $this->receipt[0] );

		// From another address, the receipt alone takes nothing back.
		$this->react( '❤️' );
		$receipt                = $this->receipt[0];
		$_SERVER['REMOTE_ADDR'] = '198.51.100.9';
		$this->assertErrorResponse( 'emojisense_not_reacted', $this->react( '❤️', 'remove', $receipt ), 409 );
		$this->assertSame( 6, Emojisense_Reactions::counts( $this->post_id )['❤️'] );
	}

	/**
	 * One client has at most a few reactions per object, whatever its cookies.
	 */
	public function test_reactions_per_object_are_capped() {
		add_filter(
			'emojisense_reaction_object_limit',
			static function () {
				return 2;
			}
		);
		$this->react( '👍' );
		$this->react( '👍' );
		$response = $this->react( '❤️' );
		$this->assertErrorResponse( 'emojisense_reaction_cap', $response, 429 );
		$this->assertGreaterThan( 0, (int) $response->get_headers()['Retry-After'] );
		$this->assertSame( array( '👍' => 2 ), Emojisense_Reactions::counts( $this->post_id ) );

		$_SERVER['REMOTE_ADDR'] = '198.51.100.9';
		$this->assertSame( 200, $this->react( '❤️' )->get_status() );
	}

	/**
	 * The author's choice replaces the defaults.
	 */
	public function test_author_choice() {
		update_post_meta( $this->post_id, Emojisense_Reactions::META_SET, array( '🚀', '🎉', 'not emoji' ) );
		$this->assertSame( array( '🚀', '🎉' ), Emojisense_Reactions::reaction_set( $this->post_id ) );
		$nonce    = wp_create_nonce( Emojisense_Reactions::NONCE_ACTION );
		$response = $this->request( 'POST', '/reactions/post/' . $this->post_id, array( 'emoji' => '🚀' ), $nonce );
		$this->assertSame(
			array(
				'🚀' => 1,
				'🎉' => 0,
			),
			$this->counts_of( $response )
		);
	}

	/**
	 * Over the limit: 429 with Retry-After, and the count does not change.
	 */
	public function test_rate_limit() {
		add_filter(
			'emojisense_reaction_rate_limit',
			static function () {
				return array(
					'limit'  => 2,
					'window' => 60,
				);
			}
		);
		$nonce = wp_create_nonce( Emojisense_Reactions::NONCE_ACTION );
		$route = '/reactions/post/' . $this->post_id;
		$this->request( 'POST', $route, array( 'emoji' => '👍' ), $nonce );
		$this->request( 'POST', $route, array( 'emoji' => '👍' ), $nonce );
		$response = $this->request( 'POST', $route, array( 'emoji' => '👍' ), $nonce );
		$this->assertSame( 429, $response->get_status() );
		$this->assertSame( 'emojisense_rate_limited', $response->get_data()['code'] );
		$this->assertGreaterThan( 0, (int) $response->get_headers()['Retry-After'] );
		$this->assertSame( 2, Emojisense_Reactions::counts( $this->post_id )['👍'] );

		// Another visitor has their own budget.
		$_SERVER['REMOTE_ADDR'] = '198.51.100.9';
		$this->assertSame( 200, $this->request( 'POST', $route, array( 'emoji' => '👍' ), $nonce )->get_status() );
	}

	/**
	 * IPv6 addresses of one /64 share a budget; an IPv4-mapped address is the IPv4 address.
	 */
	public function test_rate_limit_per_ipv6_network() {
		add_filter(
			'emojisense_reaction_rate_limit',
			static function () {
				return array(
					'limit'  => 1,
					'window' => 60,
				);
			}
		);
		$_SERVER['REMOTE_ADDR'] = '2001:db8:1:2::1';
		$this->assertSame( 200, $this->react( '👍' )->get_status() );
		$_SERVER['REMOTE_ADDR'] = '2001:db8:1:2:ffff:ffff:ffff:9';
		$this->assertSame( 429, $this->react( '👍' )->get_status() );
		$_SERVER['REMOTE_ADDR'] = '2001:db8:1:3::1';
		$this->assertSame( 200, $this->react( '👍' )->get_status() );

		$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
		$this->assertSame( 200, $this->react( '👍' )->get_status() );
		$_SERVER['REMOTE_ADDR'] = '::ffff:203.0.113.7';
		$this->assertSame( 429, $this->react( '👍' )->get_status() );
	}

	/**
	 * No personal data: counts only, and the rate limit key is not the IP address.
	 */
	public function test_no_personal_data_is_stored() {
		global $wpdb;
		$nonce = wp_create_nonce( Emojisense_Reactions::NONCE_ACTION );
		$this->request( 'POST', '/reactions/post/' . $this->post_id, array( 'emoji' => '👍' ), $nonce );

		$meta = get_post_meta( $this->post_id );
		$this->assertSame( array( Emojisense_Reactions::META_COUNTS ), array_values( preg_grep( '/^_emojisense/', array_keys( $meta ) ) ) );
		$this->assertSame( array( '👍' => 1 ), Emojisense_Reactions::counts( $this->post_id ) );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- the test reads every stored value.
		$options = $wpdb->get_col( "SELECT CONCAT(option_name, '=', option_value) FROM {$wpdb->options} WHERE option_name LIKE '%emojisense%'" );
		foreach ( $options as $option ) {
			$this->assertStringNotContainsString( '203.0.113.7', $option );
		}
	}

	/**
	 * Suggestions: editors only, the API must be on, and the request carries the key and Origin.
	 */
	public function test_suggest() {
		$route = '/suggest';
		$body  = array(
			'post_id' => $this->post_id,
			'text'    => 'We shipped it!',
		);
		$this->assertSame( 401, $this->request( 'POST', $route, $body )->get_status() );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertSame( 403, $this->request( 'POST', $route, $body )->get_status() );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->assertErrorResponse( 'emojisense_api_off', $this->request( 'POST', $route, $body ), 400 );

		update_option(
			Emojisense_Settings::OPTION,
			array_merge(
				Emojisense_Settings::get(),
				array(
					'api_enabled'     => true,
					'publishable_key' => 'pk_live_AbCdEf123456',
				)
			)
		);
		$sent = array();
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$sent ) {
				$sent = array(
					'url'  => $url,
					'args' => $args,
				);
				return array(
					'headers'  => array(),
					'body'     => wp_json_encode(
						array(
							'results' => array(
								array( 'emoji' => '🎉' ),
								array( 'emoji' => '🙌' ),
								array( 'emoji' => ':custom:' ),
							),
						)
					),
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'cookies'  => array(),
				);
			},
			10,
			3
		);
		$response = $this->request( 'POST', $route, $body );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( '🎉', '🙌' ), $response->get_data()['emoji'] );
		$this->assertStringStartsWith( 'https://api.emojisense.com/v1/suggest-reactions?', $sent['url'] );
		$this->assertStringContainsString( 'key=pk_live_AbCdEf123456', $sent['url'] );
		$this->assertSame( Emojisense_Settings::origin_of( home_url() ), $sent['args']['headers']['Origin'] );
		$this->assertSame( 'We shipped it!', json_decode( $sent['args']['body'], true )['text'] );
	}

	/**
	 * Each user has a budget of suggestion requests: they spend the site's API quota.
	 */
	public function test_suggest_rate_limit() {
		add_filter(
			'emojisense_suggest_rate_limit',
			static function () {
				return array(
					'limit'  => 1,
					'window' => 300,
				);
			}
		);
		$body = array(
			'post_id' => $this->post_id,
			'text'    => 'We shipped it!',
		);
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->assertErrorResponse( 'emojisense_api_off', $this->request( 'POST', '/suggest', $body ), 400 );
		$response = $this->request( 'POST', '/suggest', $body );
		$this->assertErrorResponse( 'emojisense_suggest_limited', $response, 429 );
		$this->assertGreaterThan( 0, (int) $response->get_headers()['Retry-After'] );

		// Another user has their own budget.
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->assertErrorResponse( 'emojisense_api_off', $this->request( 'POST', '/suggest', $body ), 400 );
	}

	/**
	 * An API error reaches the editor with advice.
	 */
	public function test_suggest_reports_origin_errors() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		update_option( Emojisense_Settings::OPTION, array_merge( Emojisense_Settings::get(), array( 'api_enabled' => true ) ) );
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'headers'  => array(),
					'body'     => '{"error":"origin not allowed for this key"}',
					'response' => array(
						'code'    => 403,
						'message' => 'Forbidden',
					),
					'cookies'  => array(),
				);
			}
		);
		$response = $this->request(
			'POST',
			'/suggest',
			array(
				'post_id' => $this->post_id,
				'text'    => 'hello',
			)
		);
		$this->assertSame( 502, $response->get_status() );
		$this->assertStringContainsString( 'allowed origins', $response->get_data()['message'] );
	}

	/**
	 * Publishing asks the API in the background; the cron job stores the suggestion.
	 */
	public function test_suggestions_after_publish() {
		update_option(
			Emojisense_Settings::OPTION,
			array_merge( Emojisense_Settings::get(), array( 'api_enabled' => true ) )
		);
		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		wp_publish_post( $post_id );
		$this->assertNotFalse( wp_next_scheduled( Emojisense_Reactions::CRON_SUGGEST, array( $post_id ) ) );

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'headers'  => array(),
					'body'     => '{"results":[{"emoji":"🎉"},{"emoji":"🚀"}]}',
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'cookies'  => array(),
				);
			}
		);
		( new Emojisense_Reactions() )->suggest_for_post( $post_id );
		$this->assertSame( array( '🎉', '🚀' ), Emojisense_Reactions::reaction_set( $post_id ) );
	}

	/**
	 * No background call without the API, or when the author chose reactions.
	 */
	public function test_no_suggestions_without_consent() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		wp_publish_post( $post_id );
		$this->assertFalse( wp_next_scheduled( Emojisense_Reactions::CRON_SUGGEST, array( $post_id ) ) );

		update_option( Emojisense_Settings::OPTION, array_merge( Emojisense_Settings::get(), array( 'api_enabled' => true ) ) );
		$chosen = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		update_post_meta( $chosen, Emojisense_Reactions::META_SET, array( '🎉' ) );
		wp_publish_post( $chosen );
		$this->assertFalse( wp_next_scheduled( Emojisense_Reactions::CRON_SUGGEST, array( $chosen ) ) );
	}

	/**
	 * The markup: buttons with code points, escaped, disabled until the script runs.
	 */
	public function test_render() {
		update_post_meta( $this->post_id, Emojisense_Reactions::META_COUNTS, array( '❤️' => 12 ) );
		$html = Emojisense_Reactions::render( $this->post_id );
		$this->assertStringContainsString( 'data-emojisense-type="post" data-emojisense-id="' . $this->post_id . '"', $html );
		$this->assertStringContainsString( 'data-emoji-hex="2764-FE0F"', $html );
		$this->assertStringContainsString( '<span class="emojisense-reaction__count">12</span>', $html );
		$this->assertSame( count( Emojisense_Settings::default_reactions() ), substr_count( $html, ' disabled>' ) );
		$this->assertTrue( wp_script_is( 'emojisense-reactions', 'enqueued' ) );
	}

	/**
	 * With a hosted set, the buttons show the set's images.
	 */
	public function test_render_with_a_hosted_set() {
		update_option(
			Emojisense_Settings::OPTION,
			array_merge(
				Emojisense_Settings::get(),
				array(
					'api_enabled'     => true,
					'emoji_set'       => 'noto',
					'publishable_key' => 'pk_live_AbCdEf123456',
				)
			)
		);
		$html = Emojisense_Reactions::render( $this->post_id );
		$this->assertStringContainsString( 'src="https://api.emojisense.com/v1/sets/noto/1F44D.svg?key=pk_live_AbCdEf123456"', $html );
		$this->assertStringContainsString( 'referrerpolicy="strict-origin-when-cross-origin"', $html );
		$this->assertStringContainsString( 'alt="👍"', $html );
	}

	/**
	 * The editor can read and write the chosen reactions; visitors cannot.
	 */
	public function test_meta_in_the_rest_api() {
		$editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor );
		$request = new WP_REST_Request( 'POST', '/wp/v2/posts/' . $this->post_id );
		$request->set_body_params( array( 'meta' => array( Emojisense_Reactions::META_SET => array( '🎉', 'x', '🚀' ) ) ) );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( '🎉', '🚀' ), get_post_meta( $this->post_id, Emojisense_Reactions::META_SET, true ) );

		$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
		wp_set_current_user( $contributor );
		$request = new WP_REST_Request( 'POST', '/wp/v2/posts/' . $this->post_id );
		$request->set_body_params( array( 'meta' => array( Emojisense_Reactions::META_SET => array( '💩' ) ) ) );
		$this->assertSame( 403, rest_get_server()->dispatch( $request )->get_status() );
	}
}
