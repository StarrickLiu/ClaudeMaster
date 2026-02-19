# 用量统计 API
from fastapi import APIRouter, Query

from services.usage_service import UsageResponse, DailyUsage, get_usage, get_daily_chart
from services.quota_service import QuotaResponse, get_quota

router = APIRouter(tags=["用量"])


@router.get(
    "/usage",
    summary="获取用量统计",
    description="返回今日用量、5 小时滑动窗口、最近 7 天每日汇总。",
)
async def usage() -> UsageResponse:
    return await get_usage()


@router.get(
    "/usage/chart",
    summary="获取用量图表数据",
    description="返回最近 N 天（7/14/30）的每日 token 用量，含零数据天。",
    response_model=list[DailyUsage],
)
async def usage_chart(days: int = Query(7, ge=7, le=30)) -> list[DailyUsage]:
    return await get_daily_chart(days)


@router.get(
    "/quota",
    summary="获取 Claude 配额余量",
    description="调用 Anthropic OAuth API 获取 5 小时窗口和 7 天窗口的真实剩余用量百分比。",
)
async def quota() -> QuotaResponse:
    return await get_quota()
