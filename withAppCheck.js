/* eslint-disable no-unused-vars */
/** 
 * Waiting on this to get merged
 * @see {@link https://github.com/invertase/react-native-firebase/pull/7662}
 */
const { ConfigPlugin, createRunOncePlugin, withPlugins, IOSConfig, WarningAggregator, withDangerousMod } = require('@expo/config-plugins');
const { AppDelegateProjectFile } = require('@expo/config-plugins/build/ios/Paths');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
const fs = require('fs');

const methodInvocationBlock = `[RNFBAppCheckModule sharedInstance];`;
// https://regex101.com/r/mPgaq6/1
const methodInvocationLineMatcher =
  /(?:self\.moduleName\s*=\s*@"([^"]*)";)|(?:(self\.|_)(\w+)\s?=\s?\[\[UMModuleRegistryAdapter alloc\])|(?:RCTBridge\s?\*\s?(\w+)\s?=\s?\[(\[RCTBridge alloc\]|self\.reactDelegate))/g;

// https://regex101.com/r/nHrTa9/1/
// if the above regex fails, we can use this one as a fallback:
const fallbackInvocationLineMatcher =
  /-\s*\(BOOL\)\s*application:\s*\(UIApplication\s*\*\s*\)\s*\w+\s+didFinishLaunchingWithOptions:/g;

/**
 * @param {string} contents 
 * @returns {string}
 */
function modifyObjcAppDelegate(contents) {
	// Add import
	if (!contents.includes('#import <RNFBAppCheckModule.h>')) {
		contents = contents.replace(
			/#import "AppDelegate.h"/g,
			`#import "AppDelegate.h"
#import <RNFBAppCheckModule.h>`,
		);
	}

	// To avoid potential issues with existing changes from older plugin versions
	if (contents.includes(methodInvocationBlock)) {
		return contents;
	}

	if (
		!methodInvocationLineMatcher.test(contents) &&
    !fallbackInvocationLineMatcher.test(contents)
	) {
		WarningAggregator.addWarningIOS(
			'@react-native-firebase/app-check',
			'Unable to determine correct Firebase insertion point in AppDelegate.m. Skipping Firebase addition.',
		);
		return contents;
	}

	// Add invocation
	try {
		return mergeContents({
			tag: '@react-native-firebase/app-check-didFinishLaunchingWithOptions',
			src: contents,
			newSrc: methodInvocationBlock,
			anchor: methodInvocationLineMatcher,
			offset: 0, // new line will be inserted right above matched anchor
			comment: '//',
		}).contents;
	} catch (e) {
		// tests if the opening `{` is in the new line
		const multilineMatcher = new RegExp(fallbackInvocationLineMatcher.source + '.+\\n*{');
		const isHeaderMultiline = multilineMatcher.test(contents);

		// we fallback to another regex if the first one fails
		return mergeContents({
			tag: '@react-native-firebase/app-didFinishLaunchingWithOptions-fallback',
			src: contents,
			newSrc: methodInvocationBlock,
			anchor: fallbackInvocationLineMatcher,
			// new line will be inserted right below matched anchor
			// or two lines, if the `{` is in the new line
			offset: isHeaderMultiline ? 2 : 1,
			comment: '//',
		}).contents;
	}
}

/** @param {AppDelegateProjectFile} appDelegateFileInfo */
async function modifyAppDelegateAsync(appDelegateFileInfo) {
	const { language, path, contents } = appDelegateFileInfo;

	if (['objc', 'objcpp'].includes(language)) {
		const newContents = modifyObjcAppDelegate(contents);
		await fs.promises.writeFile(path, newContents);
	} else {
		// TODO: Support Swift
		throw new Error(`Cannot add Firebase code to AppDelegate of language "${language}"`);
	}
}

/** @type { ConfigPlugin } */
const withFirebaseAppDelegate = config => {
	return withDangerousMod(config, [
		'ios',
		async config => {
			const fileInfo = IOSConfig.Paths.getAppDelegate(config.modRequest.projectRoot);
			await modifyAppDelegateAsync(fileInfo);
			return config;
		},
	]);
};
/**
 * A config plugin for configuring `@react-native-firebase/app-check`
 * @type { ConfigPlugin }
 */
const withRnFirebaseAppCheck = config => {
	return withPlugins(config, [
		// iOS
		withFirebaseAppDelegate,
	]);
};

const pak = require('@react-native-firebase/app-check/package.json');
module.exports = createRunOncePlugin(withRnFirebaseAppCheck, pak.name, pak.version);
