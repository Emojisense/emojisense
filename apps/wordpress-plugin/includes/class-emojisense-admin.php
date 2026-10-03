<?php
/**
 * Settings → Emojisense.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * The settings page (Settings API), the plugin list link and the connection test.
 */
class Emojisense_Admin {

	const PAGE = 'emojisense';

	/** Where people create keys and set their allowed origins. */
	const DASHBOARD_URL = 'https://app.emojisense.com';

	/**
	 * Hooks.
	 */
	public function register() {
		add_action( 'admin_menu', array( $this, 'add_page' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( EMOJISENSE_FILE ), array( $this, 'action_links' ) );
	}

	/**
	 * Adds the page under Settings.
	 */
	public function add_page() {
		add_options_page(
			__( 'Emojisense', 'emojisense' ),
			__( 'Emojisense', 'emojisense' ),
			'manage_options',
			self::PAGE,
			array( $this, 'render_page' )
		);
	}

	/**
	 * The page script (connection test, dependent fields) and style, on this page only.
	 *
	 * @param string $hook_suffix Admin page hook.
	 */
	public function enqueue_assets( $hook_suffix ) {
		if ( 'settings_page_' . self::PAGE === $hook_suffix ) {
			Emojisense_Assets::enqueue( 'admin' );
		}
	}

	/**
	 * A "Settings" link in the plugin list.
	 *
	 * @param string[] $links Action links.
	 * @return string[]
	 */
	public function action_links( $links ) {
		array_unshift(
			$links,
			sprintf( '<a href="%s">%s</a>', esc_url( admin_url( 'options-general.php?page=' . self::PAGE ) ), esc_html__( 'Settings', 'emojisense' ) )
		);
		return $links;
	}

	/**
	 * The option, its sections and fields.
	 */
	public function register_settings() {
		register_setting(
			self::PAGE,
			Emojisense_Settings::OPTION,
			array(
				'type'              => 'object',
				'sanitize_callback' => array( 'Emojisense_Settings', 'sanitize' ),
				'default'           => Emojisense_Settings::defaults(),
				'show_in_rest'      => false,
			)
		);

		add_settings_section( 'emojisense_editor', __( 'Editor', 'emojisense' ), array( $this, 'section_editor' ), self::PAGE );
		$this->add_field( 'editor_autocomplete', __( 'Colon autocomplete', 'emojisense' ), 'field_editor_autocomplete', 'emojisense_editor' );
		$this->add_field( 'locale', __( 'Language', 'emojisense' ), 'field_locale', 'emojisense_editor', true );
		$this->add_field( 'culture', __( 'Culture layer', 'emojisense' ), 'field_culture', 'emojisense_editor' );

		add_settings_section( 'emojisense_reactions', __( 'Reactions', 'emojisense' ), array( $this, 'section_reactions' ), self::PAGE );
		$this->add_field( 'reactions_post_types', __( 'Show reactions on', 'emojisense' ), 'field_post_types', 'emojisense_reactions' );
		$this->add_field( 'default_reactions', __( 'Default reactions', 'emojisense' ), 'field_default_reactions', 'emojisense_reactions', true );

		add_settings_section( 'emojisense_comments', __( 'Comments', 'emojisense' ), '__return_false', self::PAGE );
		$this->add_field( 'comment_picker', __( 'Emoji picker', 'emojisense' ), 'field_comment_picker', 'emojisense_comments' );

		$bbpress    = Emojisense_Bbpress::is_active();
		$buddypress = Emojisense_Buddypress::is_active();
		if ( $bbpress || $buddypress ) {
			add_settings_section( 'emojisense_forums', __( 'Forums and communities', 'emojisense' ), array( $this, 'section_forums' ), self::PAGE );
			$this->add_field( 'forum_fields', __( 'Emoji in forms', 'emojisense' ), 'field_forum_fields', 'emojisense_forums' );
			if ( $bbpress ) {
				$this->add_field( 'forum_reactions', __( 'Forum reactions', 'emojisense' ), 'field_forum_reactions', 'emojisense_forums' );
			}
			if ( $buddypress ) {
				$this->add_field( 'activity_reactions', __( 'Activity reactions', 'emojisense' ), 'field_activity_reactions', 'emojisense_forums' );
			}
		}

		add_settings_section( 'emojisense_api', __( 'Emojisense API', 'emojisense' ), array( $this, 'section_api' ), self::PAGE );
		$this->add_field( 'api_enabled', __( 'Connection', 'emojisense' ), 'field_api_enabled', 'emojisense_api' );
		$this->add_field( 'publishable_key', __( 'Publishable key', 'emojisense' ), 'field_publishable_key', 'emojisense_api', true );
		$this->add_field( 'semantic_search', __( 'Search by meaning', 'emojisense' ), 'field_semantic_search', 'emojisense_api' );
		$this->add_field( 'suggest_reactions', __( 'Reaction suggestions', 'emojisense' ), 'field_suggest_reactions', 'emojisense_api' );
		$this->add_field( 'emoji_set', __( 'Emoji set', 'emojisense' ), 'field_emoji_set', 'emojisense_api', true );
		$this->add_field( 'api_url', __( 'API address', 'emojisense' ), 'field_api_url', 'emojisense_api', true );
	}

	/**
	 * Adds one field.
	 *
	 * @param string $name     Setting name.
	 * @param string $title    Field title.
	 * @param string $callback Method that prints the field.
	 * @param string $section  Section ID.
	 * @param bool   $label_for Whether the title is the label of one control.
	 */
	private function add_field( $name, $title, $callback, $section, $label_for = false ) {
		add_settings_field(
			'emojisense_' . $name,
			$title,
			array( $this, $callback ),
			self::PAGE,
			$section,
			$label_for ? array( 'label_for' => self::id( $name ) ) : array()
		);
	}

	/**
	 * REST route of the connection test.
	 */
	public function register_routes() {
		register_rest_route(
			Emojisense_Reactions::REST_NAMESPACE,
			'/test-connection',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_test_connection' ),
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
			)
		);
	}

	/**
	 * Tests the saved address, key and allowed origins with one search.
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_test_connection() {
		if ( ! Emojisense_Settings::api_enabled() ) {
			return new WP_Error( 'emojisense_api_off', __( 'Turn on the connection and save the settings first.', 'emojisense' ), array( 'status' => 400 ) );
		}
		$result = Emojisense_Api_Client::test_connection();
		if ( is_wp_error( $result ) ) {
			return new WP_Error( $result->get_error_code(), $result->get_error_message(), array( 'status' => 502 ) );
		}
		$message = '' === Emojisense_Settings::publishable_key()
			? __( 'Connected without a key. Anonymous calls have a lower rate limit; add a publishable key for production.', 'emojisense' )
			: __( 'Connected. The key accepts this site.', 'emojisense' );
		return new WP_REST_Response( array( 'message' => $message ) );
	}

	/**
	 * The page.
	 */
	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap emojisense-settings">
			<h1><?php esc_html_e( 'Emojisense', 'emojisense' ); ?></h1>
			<p class="emojisense-settings__lead">
				<?php esc_html_e( 'Find emoji by what they mean. Type a colon in the block editor (:pizza, :ship it), use the emoji button in the classic editor, and add reactions to posts and an emoji picker to comments.', 'emojisense' ); ?>
			</p>
			<p class="emojisense-settings__lead">
				<?php esc_html_e( 'Search runs in the browser with files from this site. Nothing is sent anywhere until you connect the Emojisense API below.', 'emojisense' ); ?>
			</p>
			<?php if ( ! file_exists( EMOJISENSE_DIR . 'build/editor.asset.php' ) ) : ?>
				<div class="notice notice-error inline"><p><?php esc_html_e( 'The plugin scripts are missing. Install the plugin from its release zip, or run the build.', 'emojisense' ); ?></p></div>
			<?php endif; ?>
			<form action="options.php" method="post">
				<?php
				settings_fields( self::PAGE );
				do_settings_sections( self::PAGE );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}

	/**
	 * Editor section intro.
	 */
	public function section_editor() {
		echo '<p>' . esc_html__( 'Works in every text block of the block editor and in the classic editor. The toolbar of each text block also has an emoji button (in the “More” menu).', 'emojisense' ) . '</p>';
	}

	/**
	 * Reactions section intro.
	 */
	public function section_reactions() {
		echo '<p>' . esc_html__( 'Visitors can react to posts with emoji, without an account. Only the counts are stored. Authors can choose the reactions of each post in the editor sidebar.', 'emojisense' ) . '</p>';
	}

	/**
	 * API section intro: what goes out, and the key reminder.
	 */
	public function section_api() {
		echo '<p>' . esc_html__( 'Optional. With the connection on, unsure searches also ask the API for emoji with a similar meaning, published posts get reaction suggestions, and emoji can be drawn from a hosted set. The privacy policy guide (Settings → Privacy) has text for each of these.', 'emojisense' ) . '</p>';
		printf(
			'<p>%s <a href="%s" target="_blank" rel="noopener noreferrer">%s<span class="screen-reader-text"> %s</span></a></p>',
			esc_html__( 'Create a publishable key (pk_live_…) at', 'emojisense' ),
			esc_url( self::DASHBOARD_URL ),
			esc_html( 'app.emojisense.com' ),
			esc_html__( '(opens in a new tab)', 'emojisense' )
		);
		$origins = array_map(
			static function ( $origin ) {
				return '<code>' . esc_html( $origin ) . '</code>';
			},
			Emojisense_Settings::site_origins()
		);
		printf(
			'<p class="emojisense-settings__origins">%s %s</p>',
			esc_html__( 'Then add this site to the key’s allowed origins:', 'emojisense' ),
			wp_kses( implode( ' ', $origins ), array( 'code' => array() ) )
		);
	}

	/**
	 * Colon autocomplete checkbox.
	 */
	public function field_editor_autocomplete() {
		$this->checkbox( 'editor_autocomplete', __( 'Type : and a word in the block editor to get emoji suggestions', 'emojisense' ) );
	}

	/**
	 * Language select.
	 */
	public function field_locale() {
		$names    = self::locale_names();
		$current  = (string) Emojisense_Settings::value( 'locale' );
		$detected = Emojisense_Settings::pack_locale( get_locale() );
		$options  = array(
			/* translators: %s: language name, e.g. English. */
			'auto' => sprintf( __( 'Site language (%s)', 'emojisense' ), $names[ $detected ] ),
		) + $names;
		printf( '<select id="%1$s" name="%2$s" aria-describedby="%1$s-description">', esc_attr( self::id( 'locale' ) ), esc_attr( self::name( 'locale' ) ) );
		foreach ( $options as $value => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $value ), selected( $current, $value, false ), esc_html( $label ) );
		}
		echo '</select>';
		printf(
			'<p class="description" id="%s-description">%s</p>',
			esc_attr( self::id( 'locale' ) ),
			esc_html__( 'Search always understands English. This language is searched too, and its emoji names are shown.', 'emojisense' )
		);
	}

	/**
	 * Culture layer checkbox.
	 */
	public function field_culture() {
		$this->checkbox( 'culture', __( 'Add cultural and seasonal emoji after the best result (for example ⚽ after 🐐 for “goat”)', 'emojisense' ) );
	}

	/**
	 * Post types with reactions.
	 */
	public function field_post_types() {
		$selected = (array) Emojisense_Settings::value( 'reactions_post_types' );
		// Forum post types have their own setting (Forums and communities).
		$hidden = array_merge( array( 'attachment' ), Emojisense_Bbpress::POST_TYPES );
		echo '<fieldset><legend class="screen-reader-text">' . esc_html__( 'Show reactions on', 'emojisense' ) . '</legend>';
		foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $type ) {
			if ( in_array( $type->name, $hidden, true ) ) {
				continue;
			}
			printf(
				'<label class="emojisense-settings__choice"><input type="checkbox" name="%1$s[]" value="%2$s"%3$s /> %4$s</label>',
				esc_attr( self::name( 'reactions_post_types' ) ),
				esc_attr( $type->name ),
				checked( in_array( $type->name, $selected, true ), true, false ),
				esc_html( $type->labels->name )
			);
		}
		echo '</fieldset>';
	}

	/**
	 * Default reactions text input.
	 */
	public function field_default_reactions() {
		printf(
			'<input type="text" class="regular-text emojisense-settings__emoji" id="%1$s" name="%2$s" value="%3$s" aria-describedby="%1$s-description" />',
			esc_attr( self::id( 'default_reactions' ) ),
			esc_attr( self::name( 'default_reactions' ) ),
			esc_attr( implode( ' ', Emojisense_Settings::default_reactions() ) )
		);
		printf(
			'<p class="description" id="%s-description">%s</p>',
			esc_attr( self::id( 'default_reactions' ) ),
			/* translators: %d: maximum number of reactions. */
			esc_html( sprintf( __( 'Up to %d emoji, separated by spaces. Posts show these unless the author chose others or the API suggested some.', 'emojisense' ), Emojisense_Settings::MAX_REACTIONS ) )
		);
	}

	/**
	 * Comment picker checkbox.
	 */
	public function field_comment_picker() {
		$this->checkbox( 'comment_picker', __( 'Add an emoji button and colon search to the comment field', 'emojisense' ) );
	}

	/**
	 * Forums section intro.
	 */
	public function section_forums() {
		echo '<p>' . esc_html__( 'Emoji by meaning where your community writes. Search runs in the browser with the data files of the plugin.', 'emojisense' ) . '</p>';
	}

	/**
	 * Emoji button and colon search in bbPress and BuddyPress forms.
	 */
	public function field_forum_fields() {
		$places = array();
		if ( Emojisense_Bbpress::is_active() ) {
			$places[] = __( 'forum topics and replies', 'emojisense' );
		}
		if ( Emojisense_Buddypress::is_active() ) {
			$places[] = __( 'activity updates, activity comments and messages', 'emojisense' );
		}
		$this->checkbox(
			'forum_fields',
			/* translators: %s: where the emoji button appears, e.g. "forum topics and replies". */
			sprintf( __( 'Add an emoji button and colon search to %s', 'emojisense' ), implode( __( ' and ', 'emojisense' ), $places ) )
		);
	}

	/**
	 * Reactions under bbPress topics and replies.
	 */
	public function field_forum_reactions() {
		$this->checkbox( 'forum_reactions', __( 'Show reactions under forum topics and replies', 'emojisense' ) );
	}

	/**
	 * Reactions under BuddyPress activity updates.
	 */
	public function field_activity_reactions() {
		$this->checkbox( 'activity_reactions', __( 'Show reactions under activity updates', 'emojisense' ) );
	}

	/**
	 * API master switch.
	 */
	public function field_api_enabled() {
		$this->checkbox( 'api_enabled', __( 'Connect to the Emojisense API', 'emojisense' ) );
	}

	/**
	 * Publishable key input.
	 */
	public function field_publishable_key() {
		printf(
			'<input type="text" class="regular-text code" id="%1$s" name="%2$s" value="%3$s" placeholder="pk_live_…" autocomplete="off" spellcheck="false" aria-describedby="%1$s-description" />',
			esc_attr( self::id( 'publishable_key' ) ),
			esc_attr( self::name( 'publishable_key' ) ),
			esc_attr( Emojisense_Settings::publishable_key() )
		);
		printf(
			'<p class="description" id="%s-description">%s</p>',
			esc_attr( self::id( 'publishable_key' ) ),
			esc_html__( 'A publishable key is public: it is sent from the browser and only works on its allowed origins. Never use a secret key (sk_live_…) here. Without a key, the API still answers with a lower rate limit.', 'emojisense' )
		);
		printf(
			'<p><button type="button" class="button" id="emojisense-test-connection">%s</button> <span class="emojisense-settings__test-result" role="status"></span></p>',
			esc_html__( 'Test the saved settings', 'emojisense' )
		);
	}

	/**
	 * Search by meaning checkbox.
	 */
	public function field_semantic_search() {
		$this->checkbox( 'semantic_search', __( 'When a search is unsure, ask the API for emoji with a similar meaning (sends the search text)', 'emojisense' ) );
	}

	/**
	 * Reaction suggestions checkbox.
	 */
	public function field_suggest_reactions() {
		$this->checkbox( 'suggest_reactions', __( 'Suggest reactions from the post text when a post is published (sends the title and the first 256 characters)', 'emojisense' ) );
	}

	/**
	 * Emoji set select.
	 */
	public function field_emoji_set() {
		$sets    = array(
			'native'  => __( 'Native (the visitor’s system emoji)', 'emojisense' ),
			'twemoji' => __( 'Twemoji (CC BY 4.0, credit Twemoji on your site)', 'emojisense' ),
			'noto'    => __( 'Noto Emoji (Apache 2.0)', 'emojisense' ),
			'fluent'  => __( 'Fluent Emoji (MIT; no country flags)', 'emojisense' ),
		);
		$current = (string) Emojisense_Settings::value( 'emoji_set' );
		printf( '<select id="%1$s" name="%2$s" aria-describedby="%1$s-description">', esc_attr( self::id( 'emoji_set' ) ), esc_attr( self::name( 'emoji_set' ) ) );
		foreach ( $sets as $value => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $value ), selected( $current, $value, false ), esc_html( $label ) );
		}
		echo '</select>';
		printf(
			'<p class="description" id="%s-description">%s</p>',
			esc_attr( self::id( 'emoji_set' ) ),
			esc_html__( 'Shows the same emoji on every device: posts, excerpts, comments and reactions load the images from the API address. Needs a publishable key on the Solo plan or higher. Visitors’ browsers then request images from the API.', 'emojisense' )
		);
	}

	/**
	 * API address input.
	 */
	public function field_api_url() {
		printf(
			'<input type="url" class="regular-text code" id="%1$s" name="%2$s" value="%3$s" aria-describedby="%1$s-description" />',
			esc_attr( self::id( 'api_url' ) ),
			esc_attr( self::name( 'api_url' ) ),
			esc_attr( Emojisense_Settings::api_url() )
		);
		printf(
			'<p class="description" id="%s-description">%s</p>',
			esc_attr( self::id( 'api_url' ) ),
			/* translators: %s: default API address. */
			esc_html( sprintf( __( 'Change it only for a self-hosted API. Default: %s', 'emojisense' ), Emojisense_Settings::DEFAULT_API_URL ) )
		);
	}

	/**
	 * A checkbox with its label.
	 *
	 * @param string $name  Setting name.
	 * @param string $label Label text.
	 */
	private function checkbox( $name, $label ) {
		printf(
			'<label for="%1$s"><input type="checkbox" id="%1$s" name="%2$s" value="1"%3$s /> %4$s</label>',
			esc_attr( self::id( $name ) ),
			esc_attr( self::name( $name ) ),
			checked( (bool) Emojisense_Settings::value( $name ), true, false ),
			esc_html( $label )
		);
	}

	/**
	 * Element ID of a setting's control.
	 *
	 * @param string $name Setting name.
	 * @return string
	 */
	private static function id( $name ) {
		return 'emojisense-' . str_replace( '_', '-', $name );
	}

	/**
	 * Form name of a setting.
	 *
	 * @param string $name Setting name.
	 * @return string
	 */
	private static function name( $name ) {
		return Emojisense_Settings::OPTION . '[' . $name . ']';
	}

	/**
	 * Names of the pack languages, in their own language.
	 *
	 * @return array<string,string>
	 */
	public static function locale_names() {
		return array(
			'en' => 'English',
			'zh' => '中文',
			'hi' => 'हिन्दी',
			'es' => 'Español',
			'ar' => 'العربية',
			'fr' => 'Français',
			'bn' => 'বাংলা',
			'pt' => 'Português',
			'ru' => 'Русский',
			'id' => 'Bahasa Indonesia',
			'tr' => 'Türkçe',
		);
	}
}
