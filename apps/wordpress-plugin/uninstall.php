<?php
/**
 * Deleting the plugin removes its settings, the reactions of every post and its scheduled jobs.
 * Rate-limit transients expire on their own within minutes.
 *
 * @package Emojisense
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Removes the plugin's data from the current site.
 */
function emojisense_uninstall_site() {
	delete_option( 'emojisense_settings' );
	foreach ( array( '_emojisense_reaction_set', '_emojisense_suggested', '_emojisense_reaction_counts' ) as $emojisense_meta_key ) {
		delete_post_meta_by_key( $emojisense_meta_key );
	}
	wp_unschedule_hook( 'emojisense_suggest_reactions' );
}

if ( is_multisite() ) {
	foreach ( get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	) as $emojisense_site_id ) {
		switch_to_blog( $emojisense_site_id );
		emojisense_uninstall_site();
		restore_current_blog();
	}
} else {
	emojisense_uninstall_site();
}
