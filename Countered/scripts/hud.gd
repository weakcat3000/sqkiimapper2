extends PanelContainer
## HUD — Displays gold, round number, player health, and phase status.

var _gold_label: Label
var _round_label: Label
var _health_label: Label
var _phase_label: Label
var _timer_label: Label
var _start_btn: Button

signal start_battle_pressed


func _ready() -> void:
	_build_ui()


func _build_ui() -> void:
	# Style (Premium Glassmorphism TFT look)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.02, 0.04, 0.08, 0.85)  # Darker, more transparent
	style.border_color = Color(0.85, 0.7, 0.25, 0.8) # Glowing gold border
	style.set_border_width_all(2)
	style.set_corner_radius_all(12)
	style.content_margin_left = 15
	style.content_margin_right = 15
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	add_theme_stylebox_override("panel", style)

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 25)
	add_child(hbox)

	# Gold
	_gold_label = Label.new()
	_gold_label.text = "💰 Gold: 10"
	_gold_label.add_theme_font_size_override("font_size", 16)
	_gold_label.add_theme_color_override("font_color", Color(1.0, 0.85, 0.3))
	hbox.add_child(_gold_label)

	# Round
	_round_label = Label.new()
	_round_label.text = "⚔ Round: 1"
	_round_label.add_theme_font_size_override("font_size", 16)
	_round_label.add_theme_color_override("font_color", Color(0.8, 0.8, 0.9))
	hbox.add_child(_round_label)

	# Health
	_health_label = Label.new()
	_health_label.text = "❤ HP: 100"
	_health_label.add_theme_font_size_override("font_size", 16)
	_health_label.add_theme_color_override("font_color", Color(0.9, 0.3, 0.3))
	hbox.add_child(_health_label)

	# Phase
	_phase_label = Label.new()
	_phase_label.text = "📋 PREPARATION"
	_phase_label.add_theme_font_size_override("font_size", 16)
	_phase_label.add_theme_color_override("font_color", Color(0.4, 0.8, 0.4))
	hbox.add_child(_phase_label)

	# Spacer 1
	var spacer1 := Control.new()
	spacer1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hbox.add_child(spacer1)

	# Timer
	_timer_label = Label.new()
	_timer_label.text = "⏱ 60"
	_timer_label.add_theme_font_size_override("font_size", 22)
	_timer_label.add_theme_color_override("font_color", Color(0.9, 0.8, 0.3))
	hbox.add_child(_timer_label)

	# Spacer 2
	var spacer2 := Control.new()
	spacer2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hbox.add_child(spacer2)

	# Start Battle button
	_start_btn = Button.new()
	_start_btn.name = "StartBattleBtn"
	_start_btn.text = "⚔ START NOW"
	_start_btn.custom_minimum_size = Vector2(160, 35)
	_start_btn.pressed.connect(func(): start_battle_pressed.emit())
	var btn_style := StyleBoxFlat.new()
	btn_style.bg_color = Color(0.7, 0.5, 0.1, 0.9)  # Golden button
	btn_style.border_color = Color(0.9, 0.8, 0.3, 1.0)
	btn_style.set_border_width_all(2)
	btn_style.set_corner_radius_all(8)
	_start_btn.add_theme_stylebox_override("normal", btn_style)
	_start_btn.add_theme_color_override("font_color", Color(1,1,1))
	hbox.add_child(_start_btn)


func update_gold(amount: int) -> void:
	_gold_label.text = "💰 Gold: %d" % amount


func update_round(round_num: int) -> void:
	_round_label.text = "⚔ Round: %d" % round_num


func update_health(hp: int) -> void:
	_health_label.text = "❤ HP: %d" % hp


func set_phase(phase_name: String) -> void:
	_phase_label.text = "📋 %s" % phase_name.to_upper()
	_start_btn.visible = (phase_name.to_lower() == "preparation")


func set_battle_button_enabled(enabled: bool) -> void:
	_start_btn.disabled = not enabled

func update_timer(time_rem: float) -> void:
	if time_rem > 0:
		_timer_label.text = "⏱ %d" % int(ceil(time_rem))
		_timer_label.visible = true
	else:
		_timer_label.visible = false
