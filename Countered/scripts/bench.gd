extends PanelContainer
## Bench — Holds purchased units before they're placed on the board (max 8 slots).

signal unit_selected(unit_data: Dictionary, bench_index: int)
signal unit_hovered(unit_data: Dictionary)
signal unit_unhovered()

var _bench_slots: Array = []  # Array of Dictionaries (unit data or empty {})
var _buttons: Array = []
const MAX_SLOTS: int = 8


func _ready() -> void:
	_build_ui()


func _build_ui() -> void:
	# Style (Premium dark dock)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.04, 0.05, 0.1, 0.8)
	style.border_color = Color(0.4, 0.4, 0.6, 0.6)
	style.set_border_width_all(2)
	style.set_corner_radius_all(12)
	style.content_margin_left = 15
	style.content_margin_right = 15
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	add_child(vbox)

	var title := Label.new()
	title.text = "🪑 BENCH"
	title.add_theme_font_size_override("font_size", 14)
	title.add_theme_color_override("font_color", Color(0.7, 0.7, 0.85))
	vbox.add_child(title)

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 6)
	vbox.add_child(hbox)

	for i in MAX_SLOTS:
		_bench_slots.append({})
		var btn := Button.new()
		btn.name = "BenchSlot%d" % i
		btn.custom_minimum_size = Vector2(80, 55)
		btn.text = "Empty"
		btn.pressed.connect(_on_slot_pressed.bind(i))
		btn.mouse_entered.connect(_on_unit_hovered.bind(i))
		btn.mouse_exited.connect(_on_unit_unhovered)
		var btn_style := StyleBoxFlat.new()
		btn_style.bg_color = Color(0.15, 0.15, 0.2)
		btn_style.set_corner_radius_all(4)
		btn_style.set_border_width_all(1)
		btn_style.border_color = Color(0.3, 0.3, 0.4)
		btn.add_theme_stylebox_override("normal", btn_style)
		btn.add_theme_font_size_override("font_size", 9)
		hbox.add_child(btn)
		_buttons.append(btn)


## Add a unit to the first available bench slot
func add_unit(unit_data: Dictionary) -> bool:
	for i in MAX_SLOTS:
		if _bench_slots[i].is_empty():
			_bench_slots[i] = unit_data
			_update_slot_display(i)
			return true
	return false  # Bench full


## Remove unit from bench slot
func remove_unit(index: int) -> Dictionary:
	if index >= 0 and index < MAX_SLOTS and not _bench_slots[index].is_empty():
		var data: Dictionary = _bench_slots[index]
		_bench_slots[index] = {}
		_update_slot_display(index)
		return data
	return {}


## Check if bench is full
func is_full() -> bool:
	for slot in _bench_slots:
		if slot.is_empty():
			return false
	return true


## Get number of units on bench
func get_unit_count() -> int:
	var count := 0
	for slot in _bench_slots:
		if not slot.is_empty():
			count += 1
	return count


func _update_slot_display(index: int) -> void:
	if _bench_slots[index].is_empty():
		_buttons[index].text = "Empty"
		var btn_style := StyleBoxFlat.new()
		btn_style.bg_color = Color(0.15, 0.15, 0.2)
		btn_style.set_corner_radius_all(4)
		btn_style.set_border_width_all(1)
		btn_style.border_color = Color(0.3, 0.3, 0.4)
		_buttons[index].add_theme_stylebox_override("normal", btn_style)
	else:
		var data: Dictionary = _bench_slots[index]
		_buttons[index].text = "%s\n%s" % [
			data.get("name", "?"),
			data.get("element", "").capitalize()
		]
		# Color by element
		var element: String = data.get("element", "")
		var color_map := {
			"fire": Color(0.3, 0.12, 0.12),
			"water": Color(0.12, 0.18, 0.3),
			"earth": Color(0.22, 0.18, 0.12),
			"storm": Color(0.28, 0.28, 0.12),
			"light": Color(0.28, 0.28, 0.22),
			"void": Color(0.22, 0.12, 0.28)
		}
		var btn_style := StyleBoxFlat.new()
		btn_style.bg_color = color_map.get(element, Color(0.2, 0.2, 0.2))
		btn_style.set_corner_radius_all(4)
		btn_style.set_border_width_all(1)
		btn_style.border_color = Color(0.6, 0.6, 0.6)
		_buttons[index].add_theme_stylebox_override("normal", btn_style)


func _on_slot_pressed(index: int) -> void:
	if index < _bench_slots.size() and not _bench_slots[index].is_empty():
		unit_selected.emit(_bench_slots[index], index)

func _on_unit_hovered(index: int) -> void:
	if index < _bench_slots.size() and not _bench_slots[index].is_empty():
		unit_hovered.emit(_bench_slots[index])

func _on_unit_unhovered() -> void:
	unit_unhovered.emit()
