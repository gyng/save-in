# Manifest V3 Migration Checklist

## Comprehensive Testing Checklist
- [ ] Verify all API usage is compatible with Manifest V3.
- [ ] Test background scripts for proper execution and resource limits.
- [ ] Check that permissions are correctly declared and functional.
- [ ] Ensure all service workers are set up and operational.
- [ ] Validate that all content scripts inject correctly and as expected.
- [ ] Confirm storage usage adheres to new quota limits.

## Known Limitations
- Service workers have a timeout limit; long-running tasks may require alternative handling.
- Certain legacy APIs may be deprecated and not available in MV3.
- Performance may vary due to changes in background processing capabilities.

## Debugging Steps
1. **Check console logs:** Inspect logs for errors or warnings during testing.
2. **Use Chrome's built-in debugging tools:** Leverage the debugger for service workers to step through code.
3. **Review permission errors:** Ensure the correct permissions are set and granted.
4. **Examine network requests:** Check if all network requests are executed as expected.

## Common Issues and Solutions
- **Issue:** Service worker not activating.
  **Solution:** Ensure the service worker is correctly registered and there are no errors in its script.

- **Issue:** API calls failing.
  **Solution:** Verify that the APIs used are compatible with MV3 and have been correctly migrated.

- **Issue:** Permissions errors on extension startup.
  **Solution:** Recheck the manifest file for required permissions and ensure they match the functionality of the extension.

- **Issue:** Performance issues observed post-migration.
  **Solution:** Optimize network requests and background script execution to comply with MV3 guidelines.