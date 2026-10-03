<?php
/**
 * The bbPress integration: emoji in the topic and reply forms, and reactions under topics and
 * replies.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Topics and replies are posts, so their reactions use the post target. The bars go after each
 * topic and reply (not after the page content), and only public forums show them.
 */
class Emojisense_Bbpress {

	/** The bbPress post types: the settings page lists them in their own section. */
	const POST_TYPES = array( 'forum', 'topic', 'reply' );

	/** Post types with reaction bars. */
	const REACTION_POST_TYPES = array( 'topic', 'reply' );

	/** The topic and reply text fields (bbPress uses these IDs with and without its toolbar). */
	const FIELD_SELECTORS = array( '#bbp_topic_content', '#bbp_reply_content' );

	/**
	 * Whether bbPress is active.
	 *
	 * @return bool
	 */
	public static function is_active() {
		return function_exists( 'bbpress' );
	}

	/**
	 * Hooks. They do nothing until bbPress loads and the settings turn them on.
	 */
	public function register() {
		add_filter( 'emojisense_reaction_post_types', array( $this, 'reaction_post_types' ) );
		add_filter( 'emojisense_show_reactions', array( $this, 'show_reactions' ), 10, 2 );
		add_filter( 'emojisense_reactions_after_content', array( $this, 'after_content' ), 10, 2 );
		add_filter( 'emojisense_suggest_reactions_for', array( $this, 'suggest_for' ), 10, 2 );
		add_filter( 'emojisense_staticize_filters', array( $this, 'staticize_filters' ) );
		add_filter( 'emojisense_field_selectors', array( $this, 'field_selectors' ) );
		add_action( 'bbp_theme_after_reply_content', array( $this, 'render_reactions' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_fields' ) );
	}

	/**
	 * Whether forum reactions are on.
	 *
	 * @return bool
	 */
	private static function reactions_on() {
		return self::is_active() && (bool) Emojisense_Settings::value( 'forum_reactions' );
	}

	/**
	 * Topics and replies carry reactions when forum reactions are on.
	 *
	 * @param string[] $types Post types from the settings.
	 * @return string[]
	 */
	public function reaction_post_types( $types ) {
		return self::reactions_on() ? array_merge( (array) $types, self::REACTION_POST_TYPES ) : $types;
	}

	/**
	 * Topics (open or closed) and replies of public forums show reactions.
	 *
	 * @param bool    $show Whether the post shows reactions.
	 * @param WP_Post $post The post.
	 * @return bool
	 */
	public function show_reactions( $show, $post ) {
		if ( ! $post instanceof WP_Post || ! in_array( $post->post_type, self::REACTION_POST_TYPES, true ) ) {
			return $show;
		}
		if ( ! self::reactions_on() || '' !== $post->post_password ) {
			return false;
		}
		$statuses = 'topic' === $post->post_type ? array( 'publish', 'closed' ) : array( 'publish' );
		if ( ! in_array( $post->post_status, $statuses, true ) ) {
			return false;
		}
		$forum_id = 'topic' === $post->post_type ? bbp_get_topic_forum_id( $post->ID ) : bbp_get_reply_forum_id( $post->ID );
		return (bool) bbp_is_forum_public( $forum_id );
	}

	/**
	 * Forum posts get their bars after each topic and reply, not after the page content.
	 *
	 * @param bool    $append Whether to append the bar.
	 * @param WP_Post $post   The post.
	 * @return bool
	 */
	public function after_content( $append, $post ) {
		return $post instanceof WP_Post && in_array( $post->post_type, self::POST_TYPES, true ) ? false : $append;
	}

	/**
	 * New topics may get suggestions; replies never do (one API call per reply is too many).
	 *
	 * @param bool    $suggest Whether to ask the API.
	 * @param WP_Post $post    The post.
	 * @return bool
	 */
	public function suggest_for( $suggest, $post ) {
		return $post instanceof WP_Post && 'reply' === $post->post_type ? false : $suggest;
	}

	/**
	 * Hosted emoji sets also draw forum posts.
	 *
	 * @param string[] $hooks Content filters.
	 * @return string[]
	 */
	public function staticize_filters( $hooks ) {
		return self::is_active() ? array_merge( (array) $hooks, array( 'bbp_get_topic_content', 'bbp_get_reply_content' ) ) : $hooks;
	}

	/**
	 * The topic and reply fields get the emoji button and colon search.
	 *
	 * @param string[] $selectors Field selectors.
	 * @return string[]
	 */
	public function field_selectors( $selectors ) {
		if ( ! self::is_active() || ! Emojisense_Settings::value( 'forum_fields' ) ) {
			return $selectors;
		}
		return array_merge( (array) $selectors, self::FIELD_SELECTORS );
	}

	/**
	 * The reaction bar after the topic or reply in the loop.
	 */
	public function render_reactions() {
		if ( ! self::reactions_on() ) {
			return;
		}
		$post = get_post( bbp_get_reply_id() );
		if ( $post && Emojisense_Reactions::shows_reactions( $post ) ) {
			echo Emojisense_Reactions::render( $post->ID ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- render() escapes every value.
		}
	}

	/**
	 * The field script on forum pages.
	 */
	public function enqueue_fields() {
		if ( self::is_active() && Emojisense_Settings::value( 'forum_fields' ) && is_bbpress() ) {
			Emojisense_Fields::enqueue();
		}
	}
}
