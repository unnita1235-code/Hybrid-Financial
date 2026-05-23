import asyncio, json
from aequitas_ai.tools.market_data import fetch_market_price
from unittest.mock import patch, AsyncMock
from httpx import Response

async def test():
    mock_yahoo_data = {'chart': {'result': [{'meta': {'regularMarketPrice': 150.25}}]}}
    mock_response = Response(200, json=mock_yahoo_data, request=None)
    mock_get = AsyncMock(return_value=mock_response)
    with patch('httpx.AsyncClient.get', mock_get):
        result = await fetch_market_price('AAPL')
        print("RESULT:")
        print(result)

if __name__ == '__main__':
    asyncio.run(test())
