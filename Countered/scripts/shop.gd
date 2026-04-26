extends PanelContainer
## Shop — Shows 5 random units for purchase and handles gold transactions.

signal unit_purchased(unit_data: Dictionary)
signal unit_hovered(unit_data: Dictionary)
signal unit_unhovered()

var _shop_units: Array = []
var _buttons: Array = []
const REFRESH_COST: int = 2
const SHOP_SIZE: int = 5


func _ready() -> void:
	_build_ui()
	refresh_shop()


func _build_ui() -> void:
	# Premium Glassmorphism styling for the main container
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.04, 0.05, 0.1, 0.8)
	style.border_color = Color(0.6, 0.5, 0.2, 0.5)
	style.set_border_width_all(2)
	style.set_corner_radius_all(12)
	style.content_margin_left = 15
	style.content_margin_right = 15
	style.content_margin_top = 10
	style.content_margin_bottom = 10
	add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	vbox.name = "VBox"
	add_child(vbox)

	# Title row
	var title_row := HBoxContainer.new()
	vbox.add_child(title_row)

	var title := Label.new()
	title.text = "⚔ SHOP"
	title.add_theme_font_size_override("font_size", 18)
	title.add_theme_color_override("font_color", Color(0.9, 0.8, 0.4))
	title_row.add_child(title)

	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_row.add_child(spacer)

	var refresh_btn := Button.new()
	refresh_btn.name = "RefreshBtn"
	refresh_btn.text = "🔄 Refresh (%d gold)" % REFRESH_COST
	refresh_btn.pressed.connect(_on_refresh_pressed)
	title_row.add_child(refresh_btn)

	# Unit buttons row
	var hbox := HBoxContainer.new()
	hbox.name = "UnitRow"
	hbox.add_theme_constant_override("separation", 8)
	vbox.add_child(hbox)

	for i in SHOP_SIZE:
		var btn := Button.new()
		btn.custom_minimum_size = Vector2(110, 140)
		btn.text = "Empty"
		# Use bind to pass the index cleanly
		btn.pressed.connect(_on_unit_pressed.bind(i))
		btn.mouse_entered.connect(_on_unit_hovered.bind(i))
		btn.mouse_exited.connect(_on_unit_unhovered)
		hbox.add_child(btn)
		_buttons.append(btn)


func refresh_shop() -> void:
	var ids := UnitData.get_random_units(SHOP_SIZE)
	_shop_units.clear()

	for i in SHOP_SIZE:
		if i < ids.size():
			var data := UnitData.get_unit(ids[i])
			_shop_units.append(data)
			_buttons[i].text = "%s\n%s / %s\n💰 %d" % [
				data.get("name", "?"),
				data.get("attack_type", "").capitalize(),
				data.get("element", "").capitalize(),
				data.get("cost", 0)
			]
			_buttons[i].disabled = false
			# Color code using premium tinted gradients (simulated with solid colors)
			var element: String = data.get("element", "")
			var color_map := {
				"fire": Color(0.25, 0.05, 0.05, 0.9),
				"water": Color(0.05, 0.1, 0.25, 0.9),
				"earth": Color(0.15, 0.1, 0.05, 0.9),
				"storm": Color(0.15, 0.15, 0.05, 0.9),
				"light": Color(0.2, 0.2, 0.15, 0.9),
				"void": Color(0.15, 0.05, 0.2, 0.9)
			}
			var btn_style := StyleBoxFlat.new()
			btn_style.bg_color = color_map.get(element, Color(0.1, 0.1, 0.1, 0.9))
			btn_style.set_corner_radius_all(10)
			btn_style.set_border_width_all(2)
			btn_style.border_color = Color(0.85, 0.7, 0.25, 0.6) # Golden accents on cards
			_buttons[i].add_theme_stylebox_override("normal", btn_style)
		else:
			_shop_units.append({})
			_buttons[i].text = "—"
			_buttons[i].disabled = true


func _on_unit_pressed(index: int) -> void:
	if index < _shop_units.size() and not _shop_units[index].is_empty():
		unit_purchased.emit(_shop_units[index])
		AudioManager.play_sfx("buy")
		# Mark slot as sold
		_shop_units[index] = {}
		_buttons[index].text = "SOLD"
		_buttons[index].disabled = true
		unit_unhovered.emit()

func _on_unit_hovered(index: int) -> void:
	if index < _shop_units.size() and not _shop_units[index].is_empty():
		unit_hovered.emit(_shop_units[index])

func _on_unit_unhovered() -> void:
	unit_unhovered.emit()

func _on_refresh_pressed() -> void:
	# Main.gd will handle gold deduction
	refresh_shop()


func get_refresh_cost() -> int:
	return REFRESH_COST
