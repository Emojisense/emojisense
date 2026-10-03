<?php
/**
 * Reaction targets, the field script and the forum integrations without bbPress or BuddyPress.
 *
 * @package Emojisense
 */

/**
 * Emojisense_Reaction_Target, Emojisense_Fields, Emojisense_Bbpress, Emojisense_Buddypress.
 */
class Test_Emojisense_Targets extends WP_Test_REST_TestCase {

	/**
	 * The memory target.
	 *
	 * @var Test_Emojisense_Memory_Target
	 */
	private $target;

	/**
	 * Registers the memory target as "thing".
	 */
	public function set_up() {
		parent::set_up();
		update_option( Emojisense_Settings::OPTION, Emojisense_Settings::defaults() );
		$this->target = new Test_Emojisense_Memory_Target();
		$target       = $this->target;
		add_filter(
			'emojisense_reaction_targets',
			static function ( $targets ) use ( $target ) {
				$targets['thing'] = $target;
				return $targets;
			}
		);
		$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
		wp_set_current_user( 0 );
	}

	/**
	 * Removes the filters.
	 */
	public function tear_down() {
		remove_all_filters( 'emojisense_reaction_targets' );
		remove_all_filters( 'emojisense_field_selectors' );
		remove_all_filters( 'emojisense_show_activity_reactions' );
		parent::tear_down();
	}

	/**
	 * A REST request.
	 *
	 * @param string              $method HTTP method.
	 * @param string              $route  Route under the namespace.
	 * @param array<string,mixed> $params Body parameters.
	 * @param string|null         $nonce  X-Emojisense-Nonce header.
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
	 * Any target works through /reactions/<type>/<id>, with its own storage.
	 */
	public function test_a_target_gets_the_rest_routes() {
		$response = $this->request( 'GET', '/reactions/thing/5' );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'thing', $data['type'] );
		$this->assertSame( 5, $data['id'] );
		$this->assertSame( array( '👍', '🎉' ), array_column( $data['reactions'], 'emoji' ) );

		$response = $this->request( 'POST', '/reactions/thing/5', array( 'emoji' => '🎉' ), $data['nonce'] );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( '🎉' => 1 ), $this->target->counts[5] );
		$this->assertSame( 400, $this->request( 'POST', '/reactions/thing/5', array( 'emoji' => '🚀' ), $data['nonce'] )->get_status() );
	}

	/**
	 * Unknown types and hidden objects are 404.
	 */
	public function test_unknown_types_and_hidden_objects_have_no_reactions() {
		$this->assertSame( 404, $this->request( 'GET', '/reactions/thing/6' )->get_status() );
		$this->assertSame( 404, $this->request( 'GET', '/reactions/activity/5' )->get_status() );
		$this->assertSame( 404, $this->request( 'GET', '/reactions/nothing/5' )->get_status() );
	}

	/**
	 * The markup names the target type and uses its label.
	 */
	public function test_render_for_a_target() {
		$html = Emojisense_Reactions::render( 5, 'thing' );
		$this->assertStringContainsString( 'data-emojisense-type="thing" data-emojisense-id="5"', $html );
		$this->assertStringContainsString( 'aria-label="React to this thing"', $html );
		$this->assertSame( '', Emojisense_Reactions::render( 5, 'nothing' ) );
	}

	/**
	 * The field selectors: the comment field with the comment picker, plus filtered ones.
	 */
	public function test_field_selectors() {
		$this->assertSame( array(), Emojisense_Fields::selectors() );
		update_option( Emojisense_Settings::OPTION, array_merge( Emojisense_Settings::defaults(), array( 'comment_picker' => true ) ) );
		$this->assertSame( array( 'textarea[name="comment"]' ), Emojisense_Fields::selectors() );
		add_filter(
			'emojisense_field_selectors',
			static function ( $selectors ) {
				return array_merge( $selectors, array( '#custom', '#custom', '' ) );
			}
		);
		$this->assertSame( array( 'textarea[name="comment"]', '#custom' ), Emojisense_Fields::selectors() );
	}

	/**
	 * The comment form loads the field script only with the comment picker on.
	 */
	public function test_comment_form_loads_the_field_script() {
		$fields = new Emojisense_Fields();
		$this->assertSame( '<textarea></textarea>', $fields->comment_field( '<textarea></textarea>' ) );
		update_option( Emojisense_Settings::OPTION, array_merge( Emojisense_Settings::defaults(), array( 'comment_picker' => true ) ) );
		$fields->comment_field( '<textarea></textarea>' );
		if ( file_exists( EMOJISENSE_DIR . 'build/fields.asset.php' ) ) {
			$this->assertTrue( wp_script_is( 'emojisense-fields', 'enqueued' ) );
		}
	}

	/**
	 * Without bbPress and BuddyPress, the forum settings change nothing.
	 */
	public function test_forum_settings_without_the_forum_plugins() {
		update_option(
			Emojisense_Settings::OPTION,
			array_merge(
				Emojisense_Settings::defaults(),
				array(
					'forum_fields'       => true,
					'forum_reactions'    => true,
					'activity_reactions' => true,
				)
			)
		);
		$this->assertFalse( Emojisense_Bbpress::is_active() );
		$this->assertFalse( Emojisense_Buddypress::is_active() );
		$this->assertSame( array(), Emojisense_Settings::reaction_post_types() );
		$this->assertSame( array(), Emojisense_Fields::selectors() );
		$this->assertArrayNotHasKey( 'activity', Emojisense_Reactions::targets() );
	}

	/**
	 * Forum posts never get their bar after the page content; replies get no suggestions.
	 */
	public function test_forum_posts_place_their_own_bars() {
		$bbpress = new Emojisense_Bbpress();
		$topic   = new WP_Post( (object) array( 'post_type' => 'topic' ) );
		$reply   = new WP_Post( (object) array( 'post_type' => 'reply' ) );
		$post    = new WP_Post( (object) array( 'post_type' => 'post' ) );
		$this->assertFalse( $bbpress->after_content( true, $topic ) );
		$this->assertTrue( $bbpress->after_content( true, $post ) );
		$this->assertFalse( $bbpress->suggest_for( true, $reply ) );
		$this->assertTrue( $bbpress->suggest_for( true, $topic ) );
		$this->assertFalse( $bbpress->show_reactions( true, $topic ), 'bbPress is not active' );
		$this->assertTrue( $bbpress->show_reactions( true, $post ), 'other posts keep their verdict' );
	}

	/**
	 * Activity items: public activity updates only.
	 *
	 * @dataProvider activity_items
	 *
	 * @param array<string,mixed> $fields   Activity fields.
	 * @param bool                $expected Whether the item shows reactions.
	 */
	public function test_activity_items_with_reactions( $fields, $expected ) {
		$activity = (object) array_merge(
			array(
				'id'            => 3,
				'type'          => 'activity_update',
				'hide_sitewide' => 0,
				'is_spam'       => 0,
			),
			$fields
		);
		$this->assertSame( $expected, Emojisense_Activity_Reactions::shows_reactions( $activity ) );
	}

	/**
	 * Activity items and their verdicts.
	 *
	 * @return array<string, array{0: array<string,mixed>, 1: bool}>
	 */
	public function activity_items() {
		return array(
			'public update'   => array( array(), true ),
			'hidden sitewide' => array( array( 'hide_sitewide' => 1 ), false ),
			'spam'            => array( array( 'is_spam' => 1 ), false ),
			'new member'      => array( array( 'type' => 'new_member' ), false ),
			'no id'           => array( array( 'id' => 0 ), false ),
		);
	}

	/**
	 * The new settings are checkboxes: off by default, off when missing from the form.
	 */
	public function test_forum_settings_are_checkboxes() {
		$defaults = Emojisense_Settings::defaults();
		foreach ( array( 'forum_fields', 'forum_reactions', 'activity_reactions' ) as $flag ) {
			$this->assertFalse( $defaults[ $flag ], $flag );
		}
		$clean = Emojisense_Settings::sanitize( array( 'forum_fields' => '1' ) );
		$this->assertTrue( $clean['forum_fields'] );
		$this->assertFalse( $clean['forum_reactions'] );
		$this->assertFalse( $clean['activity_reactions'] );
	}
}
