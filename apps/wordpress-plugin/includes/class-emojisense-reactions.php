<?php
/**
 * Emoji reactions under posts (and, through targets, other objects such as BuddyPress activity):
 * the REST API, the markup and the suggestions from the post text.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Visitors react without an account. The plugin stores only counts per emoji. Abuse is limited by
 * a nonce and a rate limit keyed by a salted hash of the IP address that expires within minutes.
 */
class Emojisense_Reactions {

	const REST_NAMESPACE = 'emojisense/v1';

	/** The reactions the author chose for the post. */
	const META_SET = '_emojisense_reaction_set';

	/** The reactions the API suggested from the post text. */
	const META_SUGGESTED = '_emojisense_suggested';

	/** Counts per emoji: array( '👍' => 3 ). */
	const META_COUNTS = '_emojisense_reaction_counts';

	/** Nonce action of the reaction requests. */
	const NONCE_ACTION = 'emojisense_react';

	/** WP-Cron hook that asks the API for suggestions after a post is published. */
	const CRON_SUGGEST = 'emojisense_suggest_reactions';

	/** Default rate limit: reactions per client per window. */
	const RATE_LIMIT = 10;

	/** Default rate limit window, in seconds. */
	const RATE_WINDOW = 60;

	/**
	 * Whether the page already has the reactions script configuration.
	 *
	 * @var bool
	 */
	private static $configured = false;

	/**
	 * Hooks.
	 */
	public function register() {
		add_action( 'init', array( $this, 'register_meta' ) );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_filter( 'the_content', array( $this, 'append_to_content' ), 20 );
		add_action( 'wp_after_insert_post', array( $this, 'schedule_suggestions' ), 10, 4 );
		add_action( self::CRON_SUGGEST, array( $this, 'suggest_for_post' ) );
	}

	/**
	 * The chosen and the suggested reactions are editable in the block editor sidebar.
	 */
	public function register_meta() {
		foreach ( Emojisense_Settings::reaction_post_types() as $post_type ) {
			foreach ( array( self::META_SET, self::META_SUGGESTED ) as $key ) {
				register_post_meta(
					$post_type,
					$key,
					array(
						'type'              => 'array',
						'single'            => true,
						'default'           => array(),
						'sanitize_callback' => array( __CLASS__, 'sanitize_emoji_meta' ),
						'auth_callback'     => array( __CLASS__, 'can_edit_meta' ),
						'show_in_rest'      => array(
							'schema' => array(
								'type'     => 'array',
								'maxItems' => Emojisense_Settings::MAX_REACTIONS,
								'items'    => array( 'type' => 'string' ),
							),
						),
					)
				);
			}
		}
	}

	/**
	 * `sanitize_callback` of the emoji list meta.
	 *
	 * @param mixed $value Meta value.
	 * @return string[]
	 */
	public static function sanitize_emoji_meta( $value ) {
		return Emojisense_Settings::parse_emoji_list( $value );
	}

	/**
	 * `auth_callback` of the emoji list meta: people who can edit the post.
	 *
	 * @param bool   $allowed  Whether the user can edit the meta (ignored).
	 * @param string $meta_key Meta key.
	 * @param int    $post_id  Post ID.
	 * @return bool
	 */
	public static function can_edit_meta( $allowed, $meta_key, $post_id ) {
		return current_user_can( 'edit_post', (int) $post_id );
	}

	/**
	 * REST routes.
	 */
	public function register_routes() {
		$post_id = array(
			'type'     => 'integer',
			'minimum'  => 1,
			'required' => true,
		);
		$type    = array(
			'type'     => 'string',
			'pattern'  => '^[a-z_]+$',
			'required' => true,
		);
		register_rest_route(
			self::REST_NAMESPACE,
			'/reactions/(?P<type>[a-z_]+)/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'rest_get' ),
					'permission_callback' => array( $this, 'can_view' ),
					'args'                => array(
						'type' => $type,
						'id'   => $post_id,
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'rest_react' ),
					'permission_callback' => array( $this, 'can_react' ),
					'args'                => array(
						'type'   => $type,
						'id'     => $post_id,
						'emoji'  => array(
							'type'      => 'string',
							'required'  => true,
							'maxLength' => 64,
						),
						'action' => array(
							'type'    => 'string',
							'enum'    => array( 'add', 'remove' ),
							'default' => 'add',
						),
					),
				),
			)
		);
		register_rest_route(
			self::REST_NAMESPACE,
			'/suggest',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_suggest' ),
				'permission_callback' => array( $this, 'can_suggest' ),
				'args'                => array(
					'post_id' => $post_id,
					'text'    => array(
						'type'      => 'string',
						'default'   => '',
						'maxLength' => 20000,
					),
				),
			)
		);
	}

	/**
	 * The kinds of objects with reactions, by REST type.
	 *
	 * @return array<string, Emojisense_Reaction_Target>
	 */
	public static function targets() {
		/**
		 * Filters the kinds of objects that carry reactions. The BuddyPress integration adds
		 * "activity".
		 *
		 * @param array<string, Emojisense_Reaction_Target> $targets Targets by REST type.
		 */
		$targets = (array) apply_filters( 'emojisense_reaction_targets', array( 'post' => new Emojisense_Post_Reactions() ) );
		return array_filter(
			$targets,
			static function ( $target ) {
				return $target instanceof Emojisense_Reaction_Target;
			}
		);
	}

	/**
	 * The target of a REST type.
	 *
	 * @param string $type REST type, e.g. "post".
	 * @return Emojisense_Reaction_Target|null
	 */
	public static function target( $type ) {
		$targets = self::targets();
		return isset( $targets[ $type ] ) ? $targets[ $type ] : null;
	}

	/**
	 * Readable reactions: a public object of a kind with reactions.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public function can_view( $request ) {
		$target = self::target( (string) $request['type'] );
		if ( ! $target || ! $target->can_view( (int) $request['id'] ) ) {
			return new WP_Error( 'emojisense_no_reactions', __( 'There are no reactions here.', 'emojisense' ), array( 'status' => 404 ) );
		}
		return true;
	}

	/**
	 * Reacting needs the nonce from the GET answer (or the page) on top of the read rules.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public function can_react( $request ) {
		$viewable = $this->can_view( $request );
		if ( true !== $viewable ) {
			return $viewable;
		}
		$nonce = (string) $request->get_header( 'x_emojisense_nonce' );
		if ( '' === $nonce || ! wp_verify_nonce( $nonce, self::NONCE_ACTION ) ) {
			return new WP_Error( 'emojisense_bad_nonce', __( 'The page is out of date. Reload it and try again.', 'emojisense' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Suggestions are for people who can edit the post.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool
	 */
	public function can_suggest( $request ) {
		return current_user_can( 'edit_post', (int) $request['post_id'] );
	}

	/**
	 * GET: the reactions with their counts, and a fresh nonce (pages may be cached for longer
	 * than a nonce lives).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function rest_get( $request ) {
		$type     = (string) $request['type'];
		$id       = (int) $request['id'];
		$response = new WP_REST_Response(
			array(
				'type'      => $type,
				'id'        => $id,
				'reactions' => self::reactions_with_counts( $id, $type ),
				'nonce'     => wp_create_nonce( self::NONCE_ACTION ),
			)
		);
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * POST: add or take back one reaction.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_react( $request ) {
		$type   = (string) $request['type'];
		$id     = (int) $request['id'];
		$emoji  = (string) $request['emoji'];
		$target = self::target( $type );
		if ( ! $target || ! in_array( $emoji, $target->reaction_set( $id ), true ) ) {
			return new WP_Error( 'emojisense_unknown_reaction', __( 'This reaction is not offered here.', 'emojisense' ), array( 'status' => 400 ) );
		}
		$retry_after = self::consume_rate_limit();
		if ( $retry_after > 0 ) {
			// The shape of a REST error, with a Retry-After header that WP_Error cannot carry.
			return new WP_REST_Response(
				array(
					'code'    => 'emojisense_rate_limited',
					'message' => __( 'Too many reactions. Wait a minute and try again.', 'emojisense' ),
					'data'    => array( 'status' => 429 ),
				),
				429,
				array(
					'Retry-After'   => (string) $retry_after,
					'Cache-Control' => 'no-store',
				)
			);
		}

		self::change_count( $id, $emoji, 'remove' === $request['action'] ? -1 : 1, $type );
		$response = new WP_REST_Response(
			array(
				'type'      => $type,
				'id'        => $id,
				'reactions' => self::reactions_with_counts( $id, $type ),
			)
		);
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * POST /suggest: reactions for the text in the editor (which may not be saved yet).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_suggest( $request ) {
		$post_id = (int) $request['post_id'];
		$text    = (string) $request['text'];
		if ( '' === trim( $text ) ) {
			$text = self::post_text( $post_id );
		}
		$emoji = Emojisense_Api_Client::suggest_reactions( $text, Emojisense_Settings::locale(), Emojisense_Settings::MAX_REACTIONS );
		if ( is_wp_error( $emoji ) ) {
			// The editor shows the message. Problems of the request are 400, of the API 502.
			$local = in_array( $emoji->get_error_code(), array( 'emojisense_api_off', 'emojisense_empty_text' ), true );
			return new WP_Error( $emoji->get_error_code(), $emoji->get_error_message(), array( 'status' => $local ? 400 : 502 ) );
		}
		return new WP_REST_Response( array( 'emoji' => $emoji ) );
	}

	/**
	 * Whether a post shows reactions: published, public, of an enabled type.
	 *
	 * @param WP_Post $post Post.
	 * @return bool
	 */
	public static function shows_reactions( $post ) {
		$show = Emojisense_Settings::reactions_enabled_for( $post->post_type )
			&& 'publish' === $post->post_status
			&& '' === $post->post_password
			&& is_post_publicly_viewable( $post );
		/**
		 * Filters whether a post shows emoji reactions.
		 *
		 * @param bool    $show Whether the post shows reactions.
		 * @param WP_Post $post The post.
		 */
		return (bool) apply_filters( 'emojisense_show_reactions', $show, $post );
	}

	/**
	 * The reactions a post offers: the author's choice, else the suggestion, else the defaults.
	 *
	 * @param int $post_id Post ID.
	 * @return string[]
	 */
	public static function reaction_set( $post_id ) {
		foreach ( array( self::META_SET, self::META_SUGGESTED ) as $key ) {
			$list = Emojisense_Settings::parse_emoji_list( get_post_meta( $post_id, $key, true ) );
			if ( $list ) {
				return $list;
			}
		}
		return Emojisense_Settings::default_reactions();
	}

	/**
	 * The offered reactions with their counts, in the order of the set.
	 *
	 * @param int    $id   Object ID.
	 * @param string $type REST type of the object.
	 * @return array<int, array{emoji: string, count: int}>
	 */
	public static function reactions_with_counts( $id, $type = 'post' ) {
		$target = self::target( $type );
		if ( ! $target ) {
			return array();
		}
		$counts = self::counts( $id, $type );
		$list   = array();
		foreach ( $target->reaction_set( $id ) as $emoji ) {
			$list[] = array(
				'emoji' => $emoji,
				'count' => isset( $counts[ $emoji ] ) ? $counts[ $emoji ] : 0,
			);
		}
		return $list;
	}

	/**
	 * Stored counts per emoji.
	 *
	 * @param int    $id   Object ID.
	 * @param string $type REST type of the object.
	 * @return array<string,int>
	 */
	public static function counts( $id, $type = 'post' ) {
		$target = self::target( $type );
		$stored = $target ? $target->stored_counts( $id ) : array();
		$counts = array();
		if ( is_array( $stored ) ) {
			foreach ( $stored as $emoji => $count ) {
				if ( is_string( $emoji ) && Emojisense_Settings::is_emoji( $emoji ) ) {
					$counts[ $emoji ] = max( 0, (int) $count );
				}
			}
		}
		return $counts;
	}

	/**
	 * Adds `$delta` to one count, never below zero. Read, change, write: two reactions in the
	 * same instant may count as one, which is acceptable for reaction counts.
	 *
	 * @param int    $id    Object ID.
	 * @param string $emoji Emoji of the object's set.
	 * @param int    $delta +1 or -1.
	 * @param string $type  REST type of the object.
	 */
	public static function change_count( $id, $emoji, $delta, $type = 'post' ) {
		$target = self::target( $type );
		if ( ! $target ) {
			return;
		}
		$counts           = self::counts( $id, $type );
		$counts[ $emoji ] = max( 0, ( isset( $counts[ $emoji ] ) ? $counts[ $emoji ] : 0 ) + $delta );
		$target->save_counts( $id, $counts );
	}

	/**
	 * Counts one reaction against the client's limit.
	 *
	 * @return int 0 when allowed, else the seconds until the window ends.
	 */
	public static function consume_rate_limit() {
		/**
		 * Filters the reaction rate limit per client.
		 *
		 * @param array{limit: int, window: int} $rate Reactions allowed per window of seconds.
		 */
		$rate   = apply_filters(
			'emojisense_reaction_rate_limit',
			array(
				'limit'  => self::RATE_LIMIT,
				'window' => self::RATE_WINDOW,
			)
		);
		$limit  = max( 1, (int) $rate['limit'] );
		$window = max( 1, (int) $rate['window'] );
		$key    = 'emojisense_rl_' . self::client_hash();
		$now    = time();
		$entry  = get_transient( $key );
		if ( ! is_array( $entry ) || ! isset( $entry['count'], $entry['reset'] ) || $entry['reset'] <= $now ) {
			$entry = array(
				'count' => 0,
				'reset' => $now + $window,
			);
		}
		if ( $entry['count'] >= $limit ) {
			return max( 1, $entry['reset'] - $now );
		}
		++$entry['count'];
		set_transient( $key, $entry, max( 1, $entry['reset'] - $now ) );
		return 0;
	}

	/**
	 * A keyed hash of the client's IP address. The IP address itself is never stored; the hash
	 * lives only as long as the rate limit window.
	 *
	 * @return string
	 */
	private static function client_hash() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		/**
		 * Filters the client address used for the reaction rate limit, for sites behind a
		 * proxy that sets a trusted header.
		 *
		 * @param string $ip REMOTE_ADDR.
		 */
		$ip = (string) apply_filters( 'emojisense_client_ip', $ip );
		return substr( hash_hmac( 'sha256', $ip, wp_salt( 'nonce' ) ), 0, 32 );
	}

	/**
	 * Adds the reaction bar after the content of a single post.
	 *
	 * @param string $content Post content.
	 * @return string
	 */
	public function append_to_content( $content ) {
		if ( ! is_singular() || ! in_the_loop() || ! is_main_query() || is_feed() ) {
			return $content;
		}
		$post = get_post();
		if ( ! $post || get_queried_object_id() !== $post->ID || ! self::shows_reactions( $post ) ) {
			return $content;
		}
		/**
		 * Filters whether the reaction bar follows the post content. The bbPress integration
		 * places forum bars itself, after each topic and reply.
		 *
		 * @param bool    $append Whether to append the bar.
		 * @param WP_Post $post   The post.
		 */
		if ( ! apply_filters( 'emojisense_reactions_after_content', true, $post ) ) {
			return $content;
		}
		return $content . self::render( $post->ID );
	}

	/**
	 * The reaction bar. It works as plain markup (counts show without JavaScript); the script
	 * makes the buttons work and refreshes the counts.
	 *
	 * @param int    $id   Object ID.
	 * @param string $type REST type of the object.
	 * @return string
	 */
	public static function render( $id, $type = 'post' ) {
		$target = self::target( $type );
		if ( ! $target ) {
			return '';
		}
		self::enqueue_script();

		$set   = Emojisense_Settings::emoji_set();
		$items = '';
		foreach ( self::reactions_with_counts( $id, $type ) as $reaction ) {
			$emoji = $reaction['emoji'];
			$glyph = 'native' === $set
				? esc_html( $emoji )
				: sprintf(
					'<img src="%1$s" alt="%2$s" class="emojisense-reaction__image" width="20" height="20" loading="lazy" decoding="async" referrerpolicy="%3$s" />',
					esc_url( Emojisense_Emoji_Set::image_url( $emoji, $set ) ),
					esc_attr( $emoji ),
					esc_attr( Emojisense_Emoji_Set::REFERRER_POLICY )
				);
			// Code points, not the emoji: content filters such as wp_staticize_emoji() rewrite
			// emoji (and drop U+FE0F) even inside attributes.
			$items .= sprintf(
				'<button type="button" class="emojisense-reaction" data-emoji-hex="%1$s" aria-pressed="false" disabled><span class="emojisense-reaction__emoji">%2$s</span> <span class="emojisense-reaction__count">%3$s</span></button>',
				esc_attr( Emojisense_Emoji_Set::hexcode( $emoji ) ),
				$glyph,
				esc_html( number_format_i18n( $reaction['count'] ) )
			);
		}

		return sprintf(
			'<div class="emojisense-reactions" data-emojisense-type="%1$s" data-emojisense-id="%2$d"><div class="emojisense-reactions__list" role="group" aria-label="%3$s">%4$s</div><p class="emojisense-reactions__status" role="status"></p></div>',
			esc_attr( $type ),
			(int) $id,
			esc_attr( $target->label() ),
			$items
		);
	}

	/**
	 * The reactions script and, once per page, its configuration. Pages that load bars later
	 * (BuddyPress activity) call it up front.
	 */
	public static function enqueue_script() {
		$handle = Emojisense_Assets::enqueue( 'reactions' );
		if ( '' === $handle || self::$configured ) {
			return;
		}
		self::$configured = true;
		wp_add_inline_script(
			$handle,
			'window.emojisenseReactions = ' . wp_json_encode(
				array(
					'root'    => esc_url_raw( rest_url( self::REST_NAMESPACE . '/reactions/' ) ),
					'strings' => array(
						'limited' => __( 'Too many reactions. Wait a minute and try again.', 'emojisense' ),
						'failed'  => __( 'Your reaction could not be saved. Try again.', 'emojisense' ),
					),
				)
			) . ';',
			'before'
		);
	}

	/**
	 * Asks the API for suggestions once a post is published, in the background (WP-Cron), so
	 * publishing never waits for the API. Posts whose author chose reactions are skipped.
	 *
	 * @param int          $post_id     Post ID.
	 * @param WP_Post      $post        Post.
	 * @param bool         $update      Whether this is an update.
	 * @param WP_Post|null $post_before The post before the update.
	 */
	public function schedule_suggestions( $post_id, $post, $update, $post_before ) {
		if ( ! Emojisense_Settings::suggestions_enabled() || ! $post instanceof WP_Post || wp_is_post_revision( $post ) ) {
			return;
		}
		if ( 'publish' !== $post->post_status || ! Emojisense_Settings::reactions_enabled_for( $post->post_type ) ) {
			return;
		}
		/**
		 * Filters whether a published post gets reaction suggestions from the API. The bbPress
		 * integration skips forum replies: one API call per reply is too many.
		 *
		 * @param bool    $suggest Whether to ask the API.
		 * @param WP_Post $post    The post.
		 */
		if ( ! apply_filters( 'emojisense_suggest_reactions_for', true, $post ) ) {
			return;
		}
		$was_published = $post_before instanceof WP_Post && 'publish' === $post_before->post_status;
		$has_choice    = (bool) get_post_meta( $post_id, self::META_SET, true );
		$has_suggested = (bool) get_post_meta( $post_id, self::META_SUGGESTED, true );
		if ( $has_choice || ( $was_published && $has_suggested ) ) {
			return;
		}
		if ( ! wp_next_scheduled( self::CRON_SUGGEST, array( (int) $post_id ) ) ) {
			wp_schedule_single_event( time(), self::CRON_SUGGEST, array( (int) $post_id ) );
		}
	}

	/**
	 * WP-Cron: stores the API's suggestions for a post.
	 *
	 * @param int $post_id Post ID.
	 */
	public function suggest_for_post( $post_id ) {
		$post = get_post( (int) $post_id );
		if ( ! $post || ! Emojisense_Settings::suggestions_enabled() || get_post_meta( $post->ID, self::META_SET, true ) ) {
			return;
		}
		$emoji = Emojisense_Api_Client::suggest_reactions( self::post_text( $post->ID ), Emojisense_Settings::locale(), 6 );
		if ( is_array( $emoji ) && $emoji ) {
			update_post_meta( $post->ID, self::META_SUGGESTED, $emoji );
		}
	}

	/**
	 * Title and text of a post, as plain text for the API.
	 *
	 * @param int $post_id Post ID.
	 * @return string
	 */
	public static function post_text( $post_id ) {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return '';
		}
		$text = has_excerpt( $post ) ? $post->post_excerpt : excerpt_remove_blocks( $post->post_content );
		return Emojisense_Api_Client::plain_text( $post->post_title . ". \n" . $text );
	}
}
