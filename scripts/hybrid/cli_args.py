from __future__ import annotations


def product_id_cli_arg(product_id: str) -> str:
    """Формат --product-id=VALUE безопасен для id, начинающихся с «-»."""
    return f"--product-id={product_id}"
