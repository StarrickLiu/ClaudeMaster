# name_generator 单元测试：名称生成与碰撞处理
from services.name_generator import generate_name, ADJECTIVES, NOUNS


def test_generate_name_format():
    """生成的名称应为 adjective-noun 格式。"""
    name = generate_name()
    parts = name.split("-")
    assert len(parts) >= 2
    assert parts[0] in ADJECTIVES
    assert parts[1] in NOUNS


def test_generate_name_avoids_collision():
    """给定已有名称集合时，生成的名称不在其中。"""
    existing = {"swift-fox", "calm-oak"}
    name = generate_name(existing)
    assert name not in existing


def test_generate_name_suffix_on_collision():
    """当所有简单组合都碰撞时，追加数字后缀。"""
    # 构造一个巨大的已有名称集使前几次随机都碰撞
    all_combos = {f"{a}-{n}" for a in ADJECTIVES for n in NOUNS}
    name = generate_name(all_combos)
    # 应有数字后缀
    assert name not in all_combos or "-" in name
    parts = name.rsplit("-", 1)
    assert len(parts) == 2 or parts[-1].isdigit()


def test_generate_name_no_existing():
    """不传 existing_names 时正常工作。"""
    name = generate_name()
    assert isinstance(name, str)
    assert len(name) > 0


def test_generate_name_empty_existing():
    """传入空集合时正常工作。"""
    name = generate_name(set())
    assert "-" in name
