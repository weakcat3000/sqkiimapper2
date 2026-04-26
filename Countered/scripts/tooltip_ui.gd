extends PanelContainer
## Tooltip UI - Follows the mouse and displays unit stats and skills

var _name_label: Label
var _tags_label: Label
var _stats_label: Label
var _skill_name_label: Label
var _skill_desc_label: Label

func _ready() -> void:
	visible = false
	z_index = 100
	
	# Premium dark/glass style
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.05, 0.08, 0.12, 0.95)
	style.border_color = Color(0.8, 0.6, 0.2, 0.8) # Gold trim
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.content_margin_left = 12
	style.content_margin_right = 12
	style.content_margin_top = 10
	style.content_margin_bottom = 10
	
	# Add subtle shadow
	style.shadow_color = Color(0, 0, 0, 0.5)
	style.shadow_size = 5
	style.shadow_offset = Vector2(0, 4)
	add_theme_stylebox_override("panel", style)
	
	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 6)
	add_child(vbox)
	
	# Name Header (Gold)
	_name_label = Label.new()
	_name_label.add_theme_font_size_override("font_size", 18)
	_name_label.add_theme_color_override("font_color", Color(1.0, 0.85, 0.3))
	vbox.add_child(_name_label)
	
	# Element / Type (Cyan)
	_tags_label = Label.new()
	_tags_label.add_theme_font_size_override("font_size", 12)
	_tags_label.add_theme_color_override("font_color", Color(0.4, 0.8, 0.9))
	vbox.add_child(_tags_label)
	
	var sep1 := HSeparator.new()
	sep1.add_theme_constant_override("separation", 4)
	vbox.add_child(sep1)
	
	# Core Stats (HP, Atk, AS, Range)
	_stats_label = Label.new()
	_stats_label.add_theme_font_size_override("font_size", 13)
	_stats_label.add_theme_color_override("font_color", Color(0.9, 0.9, 0.9))
	vbox.add_child(_stats_label)
	
	var sep2 := HSeparator.new()
	sep2.add_theme_constant_override("separation", 4)
	vbox.add_child(sep2)
	
	# Skill Name (Purple/Magic tint)
	_skill_name_label = Label.new()
	_skill_name_label.add_theme_font_size_override("font_size", 14)
	_skill_name_label.add_theme_color_override("font_color", Color(0.8, 0.5, 1.0))
	vbox.add_child(_skill_name_label)
	
	# Skill Desc
	_skill_desc_label = Label.new()
	_skill_desc_label.add_theme_font_size_override("font_size", 12)
	_skill_desc_label.add_theme_color_override("font_color", Color(0.7, 0.7, 0.7))
	_skill_desc_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_skill_desc_label.custom_minimum_size = Vector2(220, 0)
	vbox.add_child(_skill_desc_label)

func _process(_delta: float) -> void:
	if visible:
		# Follow mouse with an offset so it doesn't block the cursor
		var m_pos = get_global_mouse_position()
		# Add 15px offset down-right
		var t_pos = m_pos + Vector2(15, 15)
		
		# Keep on screen
		var screen_rect = get_viewport_rect()
		if t_pos.y + size.y > screen_rect.size.y:
			t_pos.y = m_pos.y - size.y - 5
		if t_pos.x + size.x > screen_rect.size.x:
			t_pos.x = m_pos.x - size.x - 5
			
		position = t_pos

func show_tooltip(data: Dictionary) -> void:
	if data.is_empty():
		return
		
	# Populate
	var cost = data.get("cost", 0)
	_name_label.text = "%s (💰 %d)" % [data.get("name", "Unknown"), cost]
	
	var element = str(data.get("element", "")).capitalize()
	var role = str(data.get("role", "")).capitalize()
	var atk_type = str(data.get("attack_type", "")).capitalize()
	var armor = str(data.get("armor_type", "")).capitalize().replace("_", " ")
	
	_tags_label.text = "%s - %s\nWeapon: %s | Armor: %s" % [element, role, atk_type, armor]
	
	var hp = data.get("hp", 0)
	var matk = data.get("attack", 0)
	var mas = data.get("attack_speed", 1.0)
	var mrange = data.get("range", 1)
	
	_stats_label.text = "❤ HP: %d\n⚔ ATK: %d (%.2f/s)\n🏹 RNGE: %d" % [hp, matk, mas, mrange]
	
	var skill_name = data.get("skill_name", "No Skill")
	var mana_max = data.get("mana_max", 0)
	_skill_name_label.text = "✨ %s (Mana: %d)" % [skill_name, mana_max]
	
	_skill_desc_label.text = data.get("skill_desc", "Does absolutely nothing.")
	
	# Compute minimal size so text fits perfectly
	reset_size()
	visible = true

func hide_tooltip() -> void:
	visible = false
