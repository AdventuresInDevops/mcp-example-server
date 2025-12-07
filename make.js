/* eslint-disable n/no-process-exit */
import 'error-object-polyfill';
import fs from 'fs-extra';
import path from 'path';
import aws from 'aws-sdk';
import AwsArchitect from 'aws-architect';
import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { Route53Client, ListHostedZonesByNameCommand } from '@aws-sdk/client-route-53';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

import stackTemplate from './deployment/cloudFormationServerlessTemplate.js';

const REGION = 'eu-west-1';
aws.config.region = REGION;

const commander = new Command();

function getVersion() {
  let release_version = '0.0';
  const pull_request = '';
  const branch = process.env.GITHUB_REF;
  const build_number = `${process.env.GITHUB_RUN_NUMBER || '0'}`;

  // Builds of pull requests
  if (pull_request && !pull_request.match(/false/i)) {
    release_version = `0.${pull_request}`;
  } else if (!branch || !branch.match(/^(refs\/heads\/)?release[/-]/i)) {
    // Builds of branches that aren't main or release
    release_version = '0.0';
  } else {
    // Builds of release branches (or locally or on server)
    release_version = branch.match(/^(?:refs\/heads\/)?release[/-](\d+(?:\.\d+){0,3})$/i)[1];
  }
  return `${release_version}.${(build_number)}.0.0.0.0`.split('.').slice(0, 3).join('.');
}
const version = getVersion();
commander.version(version);

const underscoreDirname = path.dirname(fileURLToPath(import.meta.url));
const packageMetadataFile = path.join(underscoreDirname, 'package.json');
const packageMetadata = await fs.readJson(packageMetadataFile);

packageMetadata.version = version;

const apiOptions = {
  sourceDirectory: path.join(underscoreDirname, 'src'),
  description: packageMetadata.description,
  regions: [REGION]
};

commander
.command('run')
.description('Run lambda web service locally.')
.action(async () => {
  const awsArchitect = new AwsArchitect(packageMetadata, Object.assign({}, apiOptions, { regions: [REGION] }));

  try {
    const result = await awsArchitect.run(8080, () => { /* Do not log from server when running locally */ });
    console.log(JSON.stringify(result.title, null, 2));
  } catch (failure) {
    console.log(JSON.stringify(failure, null, 2));
  }
});

commander
.command('deploy')
.description('Deploy to AWS.')
.action(async () => {
  /* Local Configuration */
  process.env.CI_COMMIT_REF_SLUG = 'main';
  process.env.CI_PIPELINE_ID = Math.round(Date.now() / 1000 / 60);
  /***********************/

  if (!process.env.CI_COMMIT_REF_SLUG) {
    console.log('Deployment should not be done locally.');
    return null;
  }

  const stsClient = new STSClient({});
  const callerIdentityResponse = await stsClient.send(new GetCallerIdentityCommand({}));
  apiOptions.deploymentBucket = `rhosys-deployments-artifacts-${callerIdentityResponse.Account}-${aws.config.region}`;

  const awsArchitect = new AwsArchitect(packageMetadata, Object.assign({}, apiOptions, { regions: [REGION] }));
  const isMainBranch = process.env.CI_COMMIT_REF_SLUG === 'main';

  try {
    await awsArchitect.validateTemplate(stackTemplate);

    if (!isMainBranch) {
      throw Error('Deployment from branches other than Main Branch is not enabled');
    }

    await awsArchitect.publishLambdaArtifactPromise();
    const stackConfiguration = {
      changeSetName: `${process.env.CI_COMMIT_REF_SLUG}-${process.env.CI_PIPELINE_ID || '1'}`,
      stackName: packageMetadata.name
    };
    const parameters = {
      serviceName: packageMetadata.name,
      serviceDescription: packageMetadata.description,
      dnsName: 'mcp',
      hostedName: 'adventuresindevops.com'
    };
    const route53Client = new Route53Client({ region: REGION });
    const command = new ListHostedZonesByNameCommand({ DNSName: parameters.hostedName });
    const response = await route53Client.send(command);
    const hostedZoneId = response.HostedZones.find(hz => hz.Name === parameters.hostedName).Id.replace('/hostedzone/', '');
    parameters.hostedZoneId = hostedZoneId;
    await awsArchitect.deployTemplate(stackTemplate, stackConfiguration, parameters);

    const publicResult = await awsArchitect.publishAndDeployStagePromise({
      stage: isMainBranch ? 'production' : process.env.CI_COMMIT_REF_SLUG,
      functionName: packageMetadata.name,
      deploymentBucketName: apiOptions.deploymentBucket,
      deploymentKeyName: `${packageMetadata.name}/${version}/lambda.zip`
    });

    console.log(publicResult);
  } catch (failure) {
    console.log(failure);
    process.exit(1);
  }
  return null;
});

commander
.command('delete')
.description('Delete Stage from AWS.')
.action(async () => {
  if (!process.env.CI_COMMIT_REF_SLUG) {
    console.log('Deployment should not be done locally.');
    return null;
  }

  const awsArchitect = new AwsArchitect(packageMetadata, Object.assign({}, apiOptions, { regions: [REGION] }));
  try {
    const result = await awsArchitect.removeStagePromise(process.env.CI_COMMIT_REF_SLUG);
    console.log(result);
  } catch (failure) {
    console.log(failure);
    process.exit(1);
  }
  return null;
});

commander.on('*', () => {
  if (commander.args.join(' ') === 'tests/**/*.js') { return; }
  console.log(`Unknown Command: ${commander.args.join(' ')}`);
  commander.help();
  process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));
