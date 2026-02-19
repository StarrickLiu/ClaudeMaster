# pytest 配置：路径与公共 fixtures
import sys
from pathlib import Path

# 确保 backend/ 目录在 sys.path 中，使所有模块可直接导入
sys.path.insert(0, str(Path(__file__).parent))
