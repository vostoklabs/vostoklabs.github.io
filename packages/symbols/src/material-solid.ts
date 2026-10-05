// Written by scripts/fetch-symbols.mjs; do not edit by hand.
//
// The Material Symbols glyphs that print as one solid blob (isSolidShape), measured on their
// stored outlines (data/material-symbols-rounded.outlines.json), made from the icon font of
// @vostok/fonts whose sha256 is below. The test measures every outline again and fails when the
// font or the rule has changed until the script runs again.

export const MATERIAL_FONT_SHA256 = '5a3aac34c346621e974312782e4909ba2d642a089edd5d20f4cfc50834bdf809';

export const MATERIAL_SOLID: readonly string[] = [
  'account_tree', 'ad_units', 'airport_shuttle', 'analytics', 'announcement', 'aod',
  'apartment', 'article', 'assessment', 'assignment', 'assignment_late', 'assistant_photo',
  'attach_file', 'attachment', 'audiotrack', 'back_hand', 'backup', 'badge',
  'ballot', 'bathtub', 'bedtime', 'bolt', 'bookmark', 'bookmark_border',
  'bug_report', 'build', 'calculate', 'casino', 'change_history', 'charging_station',
  'chat_bubble', 'chess_bishop', 'chess_knight', 'chess_pawn', 'chess_queen', 'chess_rook',
  'church', 'circle', 'cloud', 'cloud_download', 'cloud_queue', 'cloud_upload',
  'cloudy_snowing', 'code_blocks', 'coffee_maker', 'color_lens', 'compost', 'confirmation_number',
  'connected_tv', 'cookie', 'copy_all', 'coronavirus', 'cottage', 'create',
  'dark_mode', 'data_exploration', 'dataset', 'dentistry', 'description', 'desktop_mac',
  'desktop_windows', 'device_unknown', 'directions_subway', 'directions_subway_filled', 'directions_transit', 'directions_transit_filled',
  'display_settings', 'docs', 'door_front', 'draft', 'dvr', 'eco',
  'edit', 'edit_attributes', 'edit_location', 'electric_meter', 'emergency', 'emergency_home',
  'emoji_events', 'error', 'extension', 'fact_check', 'family_link', 'family_star',
  'favorite', 'favorite_border', 'featured_play_list', 'feedback', 'fiber_manual_record', 'filter_drama',
  'filter_hdr', 'flag', 'flash_on', 'fmd_bad', 'fmd_good', 'folder',
  'folder_open', 'folder_zip', 'front_hand', 'garden_cart', 'gesture', 'gif_box',
  'gpp_maybe', 'grade', 'group_work', 'hand_gesture', 'heart_broken', 'heat_pump',
  'hexagon', 'highlight', 'home', 'home_app_logo', 'home_filled', 'hourglass_full',
  'house', 'humidity_high', 'icecream', 'incomplete_circle', 'info', 'insert_chart',
  'insert_drive_file', 'integration_instructions', 'keep', 'label', 'label_important', 'laptop_chromebook',
  'laptop_mac', 'laptop_windows', 'lens', 'local_convenience_store', 'local_movies', 'local_offer',
  'local_pizza', 'local_shipping', 'location_city', 'location_on', 'location_pin', 'lock_open',
  'markunread_mailbox', 'medical_information', 'meeting_room', 'mobile', 'mobile_friendly', 'mode',
  'mode_comment', 'mode_edit', 'mode_fan', 'mode_night', 'monitor', 'more',
  'movie', 'movie_creation', 'movie_filter', 'music_note', 'nature', 'nature_people',
  'navigation', 'near_me', 'nightlight', 'nightlight_round', 'note', 'notification_important',
  'notifications', 'notifications_none', 'nutrition', 'other_houses', 'outdoor_grill', 'outlined_flag',
  'palette', 'pan_tool', 'panorama_fish_eye', 'park', 'pedal_bike', 'pending',
  'pentagon', 'perm_device_information', 'personal_places', 'personal_video', 'pet_supplies', 'phone_android',
  'phone_iphone', 'pin', 'place', 'playlist_add_check_circle', 'poll', 'power',
  'privacy_tip', 'pulmonology', 'push_pin', 'rainy', 'ramen_dining', 'rectangle',
  'report', 'report_gmailerrorred', 'report_problem', 'room', 'savings', 'schema',
  'science', 'screenshot', 'screenshot_monitor', 'sd_card', 'sd_storage', 'security_update_good',
  'security_update_warning', 'sell', 'send', 'sentiment_calm', 'sentiment_content', 'sentiment_dissatisfied',
  'sentiment_neutral', 'sentiment_satisfied', 'sentiment_stressed', 'shield', 'shopping_bag', 'shopping_basket',
  'shoppingmode', 'shower', 'signpost', 'single_bed', 'skeleton', 'skull',
  'smart_screen', 'smart_toy', 'smartphone', 'sms', 'sms_failed', 'speaker_notes',
  'sports_esports', 'square', 'stadia_controller', 'star', 'star_border', 'star_border_purple500',
  'star_purple500', 'star_rate', 'star_shine', 'stay_current_landscape', 'stay_current_portrait', 'stay_primary_landscape',
  'stay_primary_portrait', 'stop', 'storefront', 'style', 'subtitles', 'summarize',
  'system_security_update_good', 'system_security_update_warning', 'tenancy', 'terrain', 'textsms', 'theaters',
  'timer', 'toys', 'toys_and_games', 'traffic', 'train', 'travel',
  'trophy', 'turned_in', 'turned_in_not', 'tv', 'tv_gen', 'upcoming',
  'videocam', 'voice_chat', 'volcano', 'warehouse', 'warning', 'warning_amber',
  'water_drop', 'wb_cloudy', 'wb_incandescent', 'wb_sunny', 'weight', 'width_full',
  'work',
];
