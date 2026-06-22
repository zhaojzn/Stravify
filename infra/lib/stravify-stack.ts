import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwAuth from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigwInt from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

// SSM SecureString parameter names. These are created manually (out-of-band)
// because CloudFormation cannot create SecureString parameters. Populate via:
//   aws ssm put-parameter --name /stravify/strava  --type SecureString --value '{"clientId":"...","clientSecret":"...","verifyToken":"..."}'
//   aws ssm put-parameter --name /stravify/spotify --type SecureString --value '{"clientId":"...","clientSecret":"..."}'
//   aws ssm put-parameter --name /stravify/lastfm  --type SecureString --value '{"apiKey":"...","sharedSecret":"..."}'
const STRAVA_PARAM_NAME = "/stravify/strava";
const SPOTIFY_PARAM_NAME = "/stravify/spotify";
const LASTFM_PARAM_NAME = "/stravify/lastfm";

// Every frontend origin allowed to use this backend (OAuth callbacks + CORS).
// The first entry is the canonical site: it becomes DEFAULT_FRONTEND_URL, so
// run links written into Strava descriptions point there.
const FRONTEND_URLS = [
  "https://jason.zhao.io",
  "https://www.jason.zhao.io",
  "http://localhost:5173",
  // Legacy stravify.net origins — kept so previously shared links and their
  // CORS/OAuth callbacks keep resolving during the transition.
  "https://stravify.net",
  "https://www.stravify.net",
  "https://stravify-live.netlify.app",
];

export class StravifyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -------------------- Cognito --------------------
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "stravify",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: {
        minLength: 10, requireDigits: true, requireLowercase: true,
        requireUppercase: false, requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const domainPrefix = `stravify-${cdk.Names.uniqueId(this).slice(-6).toLowerCase()}`;
    userPool.addDomain("Domain", { cognitoDomain: { domainPrefix } });

    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: FRONTEND_URLS.map(u => `${u}/callback`),
        logoutUrls: FRONTEND_URLS,
      },
      generateSecret: false,
    });

    // -------------------- DynamoDB --------------------
    const usersTable = new dynamodb.Table(this, "Users", {
      partitionKey: { name: "cognitoSub", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    usersTable.addGlobalSecondaryIndex({
      indexName: "byStravaAthleteId",
      partitionKey: { name: "stravaAthleteId", type: dynamodb.AttributeType.NUMBER },
    });

    const activitiesTable = new dynamodb.Table(this, "Activities", {
      partitionKey: { name: "cognitoSub", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "activityId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    activitiesTable.addGlobalSecondaryIndex({
      indexName: "byActivityId",
      partitionKey: { name: "activityId", type: dynamodb.AttributeType.STRING },
    });

    const songPlaysTable = new dynamodb.Table(this, "SongPlays", {
      partitionKey: { name: "cognitoSub", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sortKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const oauthStateTable = new dynamodb.Table(this, "OAuthState", {
      partitionKey: { name: "state", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------- Secrets (SSM Parameter Store) --------------------
    // SecureString parameters are created out-of-band (see top of file).
    // Using SSM (free) instead of Secrets Manager ($0.40/secret/mo) saves ~$1.20/mo.
    const paramArn = (name: string) =>
      `arn:aws:ssm:${this.region}:${this.account}:parameter${name}`;
    const readParamsPolicy = new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [
        paramArn(STRAVA_PARAM_NAME),
        paramArn(SPOTIFY_PARAM_NAME),
        paramArn(LASTFM_PARAM_NAME),
      ],
    });

    // -------------------- API Gateway --------------------
    const httpApi = new apigw.HttpApi(this, "Api", {
      apiName: "stravify",
      corsPreflight: {
        allowOrigins: FRONTEND_URLS,
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.DELETE,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Authorization", "Content-Type"],
      },
    });
    const apiBaseUrl = httpApi.apiEndpoint;

    const jwtAuthorizer = new apigwAuth.HttpJwtAuthorizer(
      "JwtAuth",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );

    // -------------------- Lambdas --------------------
    const lambdaRoot = path.join(__dirname, "..", "..", "lambdas");
    const lambdaSrc = path.join(lambdaRoot, "src");
    const lambdaLock = path.join(lambdaRoot, "package-lock.json");
    const sharedEnv: Record<string, string> = {
      USERS_TABLE: usersTable.tableName,
      ACTIVITIES_TABLE: activitiesTable.tableName,
      SONGPLAYS_TABLE: songPlaysTable.tableName,
      OAUTH_STATE_TABLE: oauthStateTable.tableName,
      STRAVA_PARAM_NAME: STRAVA_PARAM_NAME,
      SPOTIFY_PARAM_NAME: SPOTIFY_PARAM_NAME,
      LASTFM_PARAM_NAME: LASTFM_PARAM_NAME,
      API_BASE_URL: apiBaseUrl,
      ALLOWED_FRONTEND_URLS: FRONTEND_URLS.join(","),
      DEFAULT_FRONTEND_URL: FRONTEND_URLS[0],
    };

    const makeFn = (id: string, entry: string) =>
      new nodejs.NodejsFunction(this, id, {
        entry: path.join(lambdaSrc, entry),
        projectRoot: lambdaRoot,
        depsLockFilePath: lambdaLock,
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(30),
        environment: sharedEnv,
        bundling: { externalModules: ["@aws-sdk/*"], minify: true, target: "node20" },
      });

    const fns = {
      me: makeFn("MeFn", "api/me.ts"),
      activities: makeFn("ActivitiesFn", "api/activities.ts"),
      activityById: makeFn("ActivityFn", "api/activityById.ts"),
      topSongs: makeFn("TopSongsFn", "api/topSongs.ts"),
      sync: makeFn("SyncFn", "api/sync.ts"),
      runById: makeFn("RunByIdFn", "api/runById.ts"),
      publicRuns: makeFn("PublicRunsFn", "api/publicRuns.ts"),
      publish: makeFn("PublishFn", "api/publish.ts"),
      unlink: makeFn("UnlinkFn", "api/unlink.ts"),
      deleteMe: makeFn("DeleteMeFn", "api/deleteMe.ts"),
      preferences: makeFn("PreferencesFn", "api/preferences.ts"),
      stravaStart: makeFn("StravaStartFn", "auth/stravaStart.ts"),
      stravaCallback: makeFn("StravaCallbackFn", "auth/stravaCallback.ts"),
      spotifyStart: makeFn("SpotifyStartFn", "auth/spotifyStart.ts"),
      spotifyCallback: makeFn("SpotifyCallbackFn", "auth/spotifyCallback.ts"),
      lastfmStart: makeFn("LastfmStartFn", "auth/lastfmStart.ts"),
      lastfmCallback: makeFn("LastfmCallbackFn", "auth/lastfmCallback.ts"),
      webhook: makeFn("WebhookFn", "webhook/stravaWebhook.ts"),
    };

    // -------------------- Grants --------------------
    const allFns = Object.values(fns);
    for (const fn of allFns) {
      usersTable.grantReadWriteData(fn);
      activitiesTable.grantReadWriteData(fn);
      songPlaysTable.grantReadWriteData(fn);
      oauthStateTable.grantReadWriteData(fn);
      fn.addToRolePolicy(readParamsPolicy);
    }

    // -------------------- Routes --------------------
    const intg = (fn: lambda.IFunction) => new apigwInt.HttpLambdaIntegration(`${fn.node.id}Int`, fn);

    const authed = [
      ["GET", "/api/me", fns.me],
      ["GET", "/api/activities", fns.activities],
      ["GET", "/api/activities/{id}", fns.activityById],
      ["GET", "/api/me/top-songs", fns.topSongs],
      ["POST", "/api/sync", fns.sync],
      ["POST", "/api/runs/{id}/publish", fns.publish],
      ["POST", "/api/me/unlink", fns.unlink],
      ["POST", "/api/me/preferences", fns.preferences],
      ["DELETE", "/api/me", fns.deleteMe],
      ["GET", "/auth/strava/start", fns.stravaStart],
      ["GET", "/auth/spotify/start", fns.spotifyStart],
      ["GET", "/auth/lastfm/start", fns.lastfmStart],
    ] as const;
    for (const [method, p, fn] of authed) {
      httpApi.addRoutes({
        path: p,
        methods: [apigw.HttpMethod[method as keyof typeof apigw.HttpMethod]],
        integration: intg(fn),
        authorizer: jwtAuthorizer,
      });
    }

    const publicRoutes = [
      ["GET", "/auth/strava/callback", fns.stravaCallback],
      ["GET", "/auth/spotify/callback", fns.spotifyCallback],
      ["GET", "/auth/lastfm/callback", fns.lastfmCallback],
      ["GET", "/api/runs", fns.publicRuns],
      ["GET", "/api/runs/{id}", fns.runById],
      ["GET", "/webhooks/strava", fns.webhook],
      ["POST", "/webhooks/strava", fns.webhook],
    ] as const;
    for (const [method, p, fn] of publicRoutes) {
      httpApi.addRoutes({
        path: p,
        methods: [apigw.HttpMethod[method as keyof typeof apigw.HttpMethod]],
        integration: intg(fn),
      });
    }

    // -------------------- Outputs --------------------
    new cdk.CfnOutput(this, "ApiUrl", { value: apiBaseUrl });
    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `https://${domainPrefix}.auth.${this.region}.amazoncognito.com`,
    });
    new cdk.CfnOutput(this, "CognitoClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "StravaWebhookCallbackUrl", { value: `${apiBaseUrl}/webhooks/strava` });
    new cdk.CfnOutput(this, "AllowedFrontendUrls", { value: FRONTEND_URLS.join(", ") });
  }
}
