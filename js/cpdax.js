'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { NotSupported, DDoSProtection, AuthenticationError, PermissionDenied, ArgumentsRequired, ExchangeError, ExchangeNotAvailable, InsufficientFunds, InvalidOrder, OrderNotFound, InvalidNonce } = require ('./base/errors');
const { SIGNIFICANT_DIGITS } = require ('./base/functions/number');

//  ---------------------------------------------------------------------------

module.exports = class cpdax extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'cpdax',
            'name': 'Cpdax',
            'countries': [ 'KR' ],
            'version': 'v1',
            'rateLimit': 1500,
            'certified': true,
            // new metainfo interface
            'has': {
                'fetchCurrencies': true,
                'fetchTradingFees': true,
                'fetchOrderBook': true,
                'fetchOHLCV': false,
                'fetchMarkets': true,
                'fetchOrder': true,
                'fetchOrders': true,
                'fetchTickers': true,
                'fetchTransactions': true,
                'fetchDeposits': false,
                'fetchWithdrawals': false,
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27766244-e328a50c-5ed2-11e7-947b-041416579bb3.jpg',
                'api': {
                    'public': 'https://www.cpdax.com',
                    'private': 'https://www.cpdax.com',
                },
                'www': 'https://www.cpdax.com',
                'doc': 'https://apidocs-eng.cpdax.com/reference',
                'fees': 'https://www.cpdax.com/static/en/fee-schedule.html',
            },
            'api': {
                'public': {
                    'get': [
                        'currencies',
                        'products',
                        'tickers',
                        'tickers/detailed',
                        'tickers/{symbol}',
                        'tickers/{symbol}/detailed',
                        'trades/{symbol}',
                        'orderbook/{symbol}',
                    ],
                },
                'private': {
                    'post': [
                        'orders',
                    ],
                    'get': [
                        'orders/{symbol}',
                        'orders/{symbol}/{id}',
                        'fee-rates',
                        'balance',
                        'transactions/{product_id}',
                    ],
                    'delete': [
                        'orders/{symbol}/{id}',
                        'orders/{symbol}',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'tierBased': true,
                    'percentage': true,
                    'maker': 0.1 / 100,
                    'taker': 0.2 / 100,
                },
            },
            'exceptions': {
                'exact': {
                    'temporarily_unavailable': ExchangeNotAvailable, // Sorry, the service is temporarily unavailable. See https://www.bitfinex.com/ for more info.
                    'Order could not be cancelled.': OrderNotFound, // non-existent order
                    'No such order found.': OrderNotFound, // ?
                    'Order price must be positive.': InvalidOrder, // on price <= 0
                    'Could not find a key matching the given X-BFX-APIKEY.': AuthenticationError,
                    'Key price should be a decimal number, e.g. "123.456"': InvalidOrder, // on isNaN (price)
                    'Key amount should be a decimal number, e.g. "123.456"': InvalidOrder, // on isNaN (amount)
                    'ERR_RATE_LIMIT': DDoSProtection,
                    'Ratelimit': DDoSProtection,
                    'Nonce is too small.': InvalidNonce,
                    'No summary found.': ExchangeError, // fetchTradingFees (summary) endpoint can give this vague error message
                    'Cannot evaluate your available balance, please try again': ExchangeNotAvailable,
                },
                'broad': {
                    'This API key does not have permission': PermissionDenied, // authenticated but not authorized
                    'Invalid order: not enough exchange balance for ': InsufficientFunds, // when buying cost is greater than the available quote currency
                    'Invalid order: minimum size for ': InvalidOrder, // when amount below limits.amount.min
                    'Invalid order': InvalidOrder, // ?
                    'The available balance is only': InsufficientFunds, // {"status":"error","message":"Cannot withdraw 1.0027 ETH from your exchange wallet. The available balance is only 0.0 ETH. If you have limit orders, open positions, unused or active margin funding, this will decrease your available balance. To increase it, you can cancel limit orders or reduce/close your positions.","withdrawal_id":0,"fees":"0.0027"}
                },
            },
            'apiKey':   '752d07a5cef56223ed1b0c558fbcfb444f012f4338d132eb46c8ca6c7981928a',
            'secret':   'MmIyNDRiYTctMDMzMy00ODkyLThlNTgtZTRhNmRlN2ZjZDZm',
        });
    }

    async fetchCurrencies (params = {}) {
        let response = await this.publicGetCurrencies (params);
        let result = {};
        for (let i = 0; i < response.length; i++) {
            let currency = response[i];
            let id = this.safeValue (currency, 'name');
            let precision = this.safeInteger (currency, 'withdraw_status');
            let code = this.commonCurrencyCode (id.toUpperCase ());
            let active = currency['deposit_status'] && currency['withdraw_status'];
            result[code] = {
                'id': id,
                'code': code,
                'type': 'crypto',
                // 'payin': currency['deposit-enabled'],
                // 'payout': currency['withdraw-enabled'],
                // 'transfer': undefined,
                'name': currency['name'],
                'active': active,
                'fee': undefined, // todo need to fetch from fee endpoint
                'precision': undefined,
                'limits': {
                    'amount': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'price': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'cost': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'deposit': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'withdraw': {
                        'min': undefined,
                        'max': undefined,
                    },
                },
                'info': currency,
            };
        }
        return result;
    }

    async fetchMarkets () {
        let markets = await this.publicGetProducts ();
        let result = [];
        for (let p = 0; p < markets.length; p++) {
            let market = markets[p];
            let id = market['product_id'];
            let baseId = id.split('-')[0];
            let quoteId = id.split('-')[1];
            let base = this.commonCurrencyCode (baseId);
            let quote = this.commonCurrencyCode (quoteId);
            let symbol = base + '/' + quote;

            let precision = {
                'price': market['quote_increment'],
                'amount': market['unit_size'],
            };
            let limits = {
                'amount': {
                    'min': this.safeFloat (market, 'min_size'),
                    'max': this.safeFloat (market, 'max_size'),
                },
                'price': {
                    'min': 2,
                    'max': 100,
                },
            };
            limits['cost'] = {
                'min': limits['amount']['min'] * limits['price']['min'],
                'max': undefined,
            };
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'baseId': baseId,
                'quoteId': quoteId,
                'active': true,
                'precision': precision,
                'limits': limits,
                'info': market,
            });
        }
        return result;
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        let tickers = await this.publicGetTickers (params);
        return tickers;
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        let ticker = await this.publicGetTickersSymbolDetailed (this.extend ({
            'symbol': symbol,
        }, params));

        return ticker;
    }

    async fetchOrders (symbol, params = {}) {
        await this.loadMarkets ();
        let response = await this.privateGetOrdersSymbol (this.extend ({
            'symbol': symbol,
        }, params));
        return response;
    }

    async fetchOrder (id, symbol, params = {}) {
        await this.loadMarkets ();
        let response = await this.privateGetOrdersSymbolId (this.extend ({
            'id': id, 'symbol': symbol
        }, params));
        return response;
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let request = await this.publicGetOrderbookSymbol (this.extend ({
            'symbol': symbol,
        }, params));
        return request;
    }

    async fetchTrades (symbol, since = undefined, limit = 50, params = {}) {
        await this.loadMarkets ();
        let request = {
            'symbol': symbol,
            'limit_trades': limit,
        };
        if (since !== undefined)
            request['timestamp'] = parseInt (since / 1000);
        let response = await this.publicGetTradesSymbol (this.extend (request, params));
        return response;
    }

    async fetchBalance (symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let response = await this.privateGetBalance (params);
        return response;
    }

    async fetchTransactions (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let response = await this.privateGetTransactionsId (this.extend ({
            'id': id,
        }, params));
        return response;
    }

    async fetchTradingFees (params = {}) {
        await this.loadMarkets ();
        let response = await this.privateGetFeeRates (params);
        return {
            'info': response,
            'maker': this.safeFloat (response, 'maker_fee'),
            'taker': this.safeFloat (response, 'taker_fee'),
        };
    }


    async cancelOrder (id, symbol = undefined, params = {}) {
        if (!id) {return undefined};
        let response = await this.privateDeleteOrdersSymbolId ({'id': id, 'symbol': symbol});
        return response;
    }

    async cancelOrders (symbol = undefined, params = {}) {
        let response = await this.privateDeleteOrdersSymbol ({'symbol': symbol});
        return response;
    }

    async createOrder (params = {}) {
        let result = await this.privatePostOrders (params);
        return result;
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let request = '/' + this.implodeParams (path, params);
        request = '/' + this.version + request;
        let query = this.omit (params, this.extractParams (path));
        let url = this.urls['api'] + request;

        if ((api === 'public') || (path.indexOf ('/hist') >= 0)) {
            if (Object.keys (query).length) {
                let suffix = '?' + this.urlencode (query);
                url += suffix;
                request += suffix;
            }
        }

        if (api == 'private') {
            let timestamp = this.nonce();
            query = this.extend ({
                'request': request,
            }, query);

            let payload = this.apiKey + timestamp + method.toUpperCase() + request;
            // query = this.json (query);
            if (method == 'POST' && params) {
                body = params
                payload += JSON.stringify(body);
            }

            let signature = this.hmac (payload, this.secret, 'sha256');
            headers = {
                "CP-ACCESS-KEY": this.apiKey,
                "CP-ACCESS-TIMESTAMP": timestamp,
                "CP-ACCESS-DIGEST": signature,
            };

        }

        url = this.urls['api'][api] + request;

        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }


    handleErrors (code, reason, url, method, headers, body) {
        if (body.length < 2)
            return;
        if (code >= 400) {
            if (body[0] === '{') {
                const response = JSON.parse (body);
                const feedback = this.id + ' ' + this.json (response);
                let message = undefined;
                if ('message' in response) {
                    message = response['message'];
                } else if ('error' in response) {
                    message = response['error'];
                } else {
                    throw new ExchangeError (feedback); // malformed (to our knowledge) response
                }
                const exact = this.exceptions['exact'];
                if (message in exact) {
                    throw new exact[message] (feedback);
                }
                const broad = this.exceptions['broad'];
                const broadKey = this.findBroadlyMatchedKey (broad, message);
                if (broadKey !== undefined) {
                    throw new broad[broadKey] (feedback);
                }
                throw new ExchangeError (feedback); // unknown message
            }
        }
    }
};
