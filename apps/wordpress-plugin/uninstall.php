<?php
/**
 * Deleting the plugin removes its settings, the reactions of every post and activity item, and its
 * scheduled jobs. Rate-limit transients expire on their own within a day.
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

/**
 * Removes the reaction counts of BuddyPress activity items. BuddyPress may be inactive when the
 * plugin is deleted, so this goes to its table directly (one table for the whole network).
 */
function emojisense_uninstall_activity() {
	global $wpdb;
	$emojisense_table = $wpdb->base_prefix . 'bp_activity_meta';
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-time cleanup of a table that may have no API.
	if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $emojisense_table ) ) ) !== $emojisense_table ) {
		return;
	}
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- see above.
	$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE meta_key = %s', $emojisense_table, '_emojisense_reaction_counts' ) );
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
emojisense_uninstall_activity();
