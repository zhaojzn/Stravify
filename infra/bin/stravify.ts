#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { StravifyStack } from "../lib/stravify-stack";

const app = new cdk.App();
new StravifyStack(app, "StravifyStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-west-1",
  },
});
