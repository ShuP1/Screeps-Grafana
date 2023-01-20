const dotenv = require('dotenv')
const axios = require('axios');
const { execSync } = require('child_process');
const { join } = require('path');
const getDashboards = require('../../dashboards/helper.js');
const setup = require('./setup.js');
const fs = require('fs');

const minimist = require('minimist')
const argv = minimist(process.argv.slice(2));
console.dir(argv);

const isWindows = process.platform === 'win32';
let grafanaPort;
let grafanaApiUrl;
dotenv.config({ path: join(__dirname, '../../conf/.env.grafana') });

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, prettyPrint } = format;
const logger = createLogger({
    format: combine(
        timestamp(),
        prettyPrint(),
    ),
    transports: [new transports.File({ filename: 'logs/setup.log' })],
});

function sleep(milliseconds) {
    // eslint-disable-next-line no-promise-executor-return
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const dashboards = getDashboards();
const login = {
    username: process.env.GF_SECURITY_ADMIN_USER,
    password: process.env.GF_SECURITY_ADMIN_PASSWORD,
};

function handleError(type, err) {
    logger.error(`${type} dashboard error: `, err);
    console.error(`${type} dashboard error: `, err.message, err.stack);
}

class GrafanaInitializer {
    static async SetupServiceInfoDashboard() {
        try {
            const dashboard = dashboards.serviceInfo;
            await axios({
                url: `${grafanaApiUrl}/dashboards/db`,
                method: 'post',
                auth: login,
                data: dashboard,
            });
            console.log('Service-Info dashboard setup done!');
        } catch (err) {
            handleError("Service-Info", err)
        }
    }

    static async SetupStatsDashboard() {
        try {
            const dashboard = dashboards.stats;
            await axios({
                url: `${grafanaApiUrl}/dashboards/db`,
                method: 'post',
                auth: login,
                data: dashboard,
            });
            console.log('Stats dashboard setup done');
        } catch (err) {
            handleError("Stats", err)
        }
    }

    static async SetupServerStatsDashboard() {
        try {
            const dashboard = dashboards.serverStats;
            await axios({
                url: `${grafanaApiUrl}/dashboards/db`,
                method: 'post',
                auth: login,
                data: dashboard,
            });
            console.log('Server-Stats dashboard setup done');
        } catch (err) {
            handleError("Server-Stats", err)
        }
    }

    static async SetupAdminUtilsServerStatsDashboard() {
        try {
            const dashboard = dashboards.adminUtilsServerStats;
            await axios({
                url: `${grafanaApiUrl}/dashboards/db`,
                method: 'post',
                auth: login,
                data: dashboard,
            });
            console.log('Admin-Utils-Server-Stats dashboard setup done');
        } catch (err) {
            handleError("Admin-Utils-Server-Stats", err)
        }
    }

    static async Start() {
        await setup(argv);
        dotenv.config({ path: join(__dirname, '../../.env') });

        grafanaPort = process.env.GRAFANA_PORT;
        grafanaApiUrl = `http://localhost:${grafanaPort}/api`
        console.log(`Grafana API URL: ${grafanaApiUrl}, serverPort: ${process.env.SERVER_PORT}`);

        const dockerComposePath = join(__dirname, '../../docker-compose.yml');
        const commands = [{command: `docker-compose -f ${dockerComposePath} down --volumes --remove-orphans`, name: 'docker-compose down'},
            {command: `docker-compose -f ${dockerComposePath} build --no-cache`, name: 'docker-compose build',},
            {command: `docker-compose -f ${dockerComposePath} up -d`, name: 'docker-compose up'},
        ];
        const disableWhisperFolderExport = argv.disableWhisperFolderExport === "true";
        const whisperPath = join(__dirname, '../../whisper');
        if (!disableWhisperFolderExport && !isWindows && fs.existsSync(whisperPath)) commands.push(`sudo chmod -R 777 ${whisperPath}`);

        for (let i = 0; i < commands.length; i += 1) {
            const commandInfo = commands[i];
            try {
                console.log(`Running command ${commandInfo.name}`);
                execSync(commandInfo.command, {stdio: 'pipe'});
            } catch (error) {
                console.log(`Command ${commandInfo.name} errored`, error);
            }
        }

        console.log('Pre setup done!\r\nWaiting for Grafana to start...\r\n');
        await sleep(30 * 1000);

        await this.SetupServiceInfoDashboard();
        await this.SetupAdminUtilsServerStatsDashboard();
        switch (argv.grafanaType) {
            case 'private':
                await this.SetupStatsDashboard();
                await this.SetupServerStatsDashboard();
                break;
            case 'mmo':
                await this.SetupStatsDashboard();
                break;
            default:
                break;
        }
        console.log('Setup done');
    }
}
GrafanaInitializer.Start();
