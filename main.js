//helper for global base directory
global.__base = __dirname + '/';

//external required modules
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var querystring = require('querystring');
var fs = require('fs');
var http = require('http');
var passport = require('passport');
var util = require('util');
var Table = require('cli-table');
var logger = require('./config/logger');
var configOptions = require('./config/options');
var pkg = require('./package.json');
var async = require('async');
var cluster = require('cluster');
var NodeCache = require(__base + 'lib/cluster-node-cache');
var Metrics = require(__base + 'lib/metrics');
var restSourceCache = new NodeCache( cluster, { stdTTL: configOptions.REST_TTL, checkperiod: configOptions.REST_CHECK_PERIOD }, 'restSourceNameSpace' );
var notifySourceCache = new NodeCache( cluster, { stdTTL: configOptions.NOTIFY_TTL, checkperiod: configOptions.NOTIFY_CHECK_PERIOD }, 'notifySourceNameSpace' );
var currentDeviceCache = new NodeCache(cluster, { stdTTL: configOptions.CURRENT_DEVICE_TTL, checkperiod: configOptions.CURRENT_DEVICE_CHECK_PERIOD }, 'currentDeviceNameSpace' );
var restMetrics = new Metrics(restSourceCache);
var notifyMetrics = new Metrics(notifySourceCache);

//-----------------------------------------------------------------------
//Function: refreshSummaryInfo
//
//Description: Refresh the summary notification information
//
//Parameters: None
//
//Returns: None
//-----------------------------------------------------------------------
function refreshSummaryInfo() {
    var totalInfoTable = new Table();
    currentDeviceCache.getStats().then(function(statsResults) {
        var currentDevCount = statsResults.keys;
        totalInfoTable.push(
                {'Current Device Count': currentDevCount}
        );
        logger.info("Total Information Stats\n" + totalInfoTable.toString());
    });
    notifyMetrics.logMetrics("Noitifications");
    restMetrics.logMetrics("REST APIs");
}

if (process.env.WORKER_ID !== undefined) {
    logger.info("Worker [%s]: CMX API Server starting", process.env.WORKER_ID);

    // pass passport for configuration
    require(__dirname + '/config/passport')(passport);

    var app = express();
    var exphbs = require('express-handlebars');
    logger.info("Worker [%s]: Created express handlebars", process.env.WORKER_ID);

    // required for passport
    if (configOptions.DO_API_AUTHENTICATION) {
        passport.cmx_strategy = 'api-login';
    } else {
        passport.cmx_strategy = 'api-anonymous';
    }

    app.use(passport.initialize());
    logger.info("Worker [%s]: Initialized passport session", process.env.WORKER_ID);

    var hbs = exphbs.create({
        extname:'.hbs',
        defaultLayout:'layout.handlebars',
    });

    // view engine setup
    app.set('views', path.join(__dirname, 'views'));
    app.engine('handlebars', exphbs(hbs));
    app.set('view engine', 'handlebars');

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
        extended: true
    }));
    app.use(cookieParser());

    // API routes
    var clientsApiRoute = require('./routes/api/clients')(passport, currentDeviceCache, restSourceCache);
    var configApiRoute = require('./routes/api/config')(passport);
    var notifyApiRoute = require('./routes/api/notify')(currentDeviceCache, notifySourceCache);
    var metricsApiRoute = require('./routes/api/metrics')(passport, restMetrics, notifyMetrics);

    app.use('/api/v3/location/clients', clientsApiRoute);
    app.use('/api/v1/config', configApiRoute);
    app.use('/api/v1/notify', notifyApiRoute);
    app.use('/api/v1/metrics', metricsApiRoute);

    logger.info("Worker [%s]: API routes configured" , process.env.WORKER_ID);

    if (process.env.WORKER_INFO_STATS === "true") {
        logger.info("Worker [%s]: Worker info stats being executed from this worker", process.env.WORKER_ID);
        setInterval(refreshSummaryInfo, configOptions.LOG_SUMMARY_INFO_STATS_INTERVAL * 1000);
    }

    // catch 404 and forward to error handler
    app.use(function(req, res, next) {
        logger.warn("Request to access invalid URL: %s from: %s", req.url, req.connection.remoteAddress);
        var err = {};
        err.status = 404;
        next(err);
    });

    // error handlers
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });

    logger.info("Worker [%s]: Completed initialization of CMX API Server version: %s", process.env.WORKER_ID, pkg.version);
    logger.info("Worker [%s]: Listening on port: %s using HTTPS protocol: %s do API authentication: %s", process.env.WORKER_ID, process.env.WORKER_PORT, configOptions.DO_HTTPS, configOptions.DO_API_AUTHENTICATION);
}
module.exports = app;
